import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import {
  dayEntries,
  employees,
  leaveAdjustments,
  leaveRequests,
  leaveTypeEnum,
  timesheets,
  type Employee,
  type LeaveRequestRow,
} from '@/db/schema';
import { type LeaveType, type ResolvedDay, annualEntitlementDays, eachDay, isWorkday, resolveDay } from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { loadRulesContext } from './rulesContext';
import type { Actor } from './timesheets';
import { type Result, fail, isoDate, ok, parse } from './validation';

/** Leave types with a yearly allowance. Others (unpaid, bereavement, …) are approved case by case. */
export const TRACKED_TYPES = ['annual', 'sick'] as const;
export type TrackedType = (typeof TRACKED_TYPES)[number];

/** Paid sick days a year under Jordanian labour law, as we understand it — HR to confirm. */
export const SICK_DAYS_PER_YEAR = 14;
const MAX_REQUEST_DAYS = 90;

export interface Balance {
  type: TrackedType;
  year: number;
  entitlement: number;
  adjustments: number;
  /** Leave recorded on workdays this year (past and already-booked future days). */
  taken: number;
  /** Requests still waiting for approval. */
  pending: number;
  available: number;
}

const isTracked = (t: LeaveType): t is TrackedType => (TRACKED_TYPES as readonly string[]).includes(t);

export async function getBalances(db: DB, employeeId: string, year: number): Promise<Balance[]> {
  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee) return [];
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [ctx, entries, adjustments, pending] = await Promise.all([
    loadRulesContext(db),
    db
      .select()
      .from(dayEntries)
      .where(and(eq(dayEntries.employeeId, employeeId), gte(dayEntries.date, from), lte(dayEntries.date, to))),
    db
      .select()
      .from(leaveAdjustments)
      .where(and(eq(leaveAdjustments.employeeId, employeeId), eq(leaveAdjustments.year, year))),
    db
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.status, 'pending'),
          gte(leaveRequests.fromDate, from),
          lte(leaveRequests.fromDate, to),
        ),
      ),
  ]);

  return TRACKED_TYPES.map((type) => {
    // Entitlement is set by service on 1 January of the year (HR can adjust mid-year).
    const entitlement =
      type === 'annual' ? annualEntitlementDays(employee.hireDate ?? from, from) : SICK_DAYS_PER_YEAR;
    const adj = adjustments.filter((a) => a.type === type).reduce((s, a) => s + a.days, 0);
    const taken = entries
      .filter((e) => e.leaveType === type && isWorkday(resolveDay(ctx, employeeId, e.date).dayType))
      .reduce((s, e) => s + (e.leavePortion ?? 1), 0);
    const waiting = pending.filter((r) => r.type === type).reduce((s, r) => s + r.daysUsed, 0);
    return { type, year, entitlement, adjustments: adj, taken, pending: waiting, available: entitlement + adj - taken - waiting };
  });
}

export const requestInput = z.object({
  type: z.enum(leaveTypeEnum.enumValues),
  fromDate: isoDate,
  toDate: isoDate,
  halfDay: z.boolean().default(false),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type RequestInput = z.input<typeof requestInput>;

export interface Preview {
  daysUsed: number;
  /** Every date in the range with what the rules say about it. */
  days: ResolvedDay[];
  balance: Balance | null;
  balanceAfter: number | null;
}

/** What a request would use, without saving anything. Also the validation for creating one. */
export async function previewRequest(db: DB, employeeId: string, input: RequestInput): Promise<Result<Preview>> {
  const parsed = parse(requestInput, input);
  if (!parsed.ok) return parsed;
  const r = parsed.value;
  if (r.toDate < r.fromDate) return fail('end_before_start');
  if (r.halfDay && r.fromDate !== r.toDate) return fail('invalid_input', 'a half day must be a single date');
  if (r.fromDate.slice(0, 4) !== r.toDate.slice(0, 4)) return fail('cross_year');
  const dates = eachDay(r.fromDate, r.toDate);
  if (dates.length > MAX_REQUEST_DAYS) return fail('invalid_input', `at most ${MAX_REQUEST_DAYS} days per request`);

  const ctx = await loadRulesContext(db);
  const days = dates.map((d) => resolveDay(ctx, employeeId, d));
  const workdays = days.filter((d) => isWorkday(d.dayType)).length;
  const daysUsed = r.halfDay ? workdays * 0.5 : workdays;
  if (daysUsed === 0) return fail('no_working_days');

  const overlapping = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        lte(leaveRequests.fromDate, r.toDate),
        gte(leaveRequests.toDate, r.fromDate),
      ),
    );
  if (overlapping.length) return fail('leave_overlap');

  const balance = isTracked(r.type)
    ? ((await getBalances(db, employeeId, Number(r.fromDate.slice(0, 4)))).find((b) => b.type === r.type) ?? null)
    : null;
  return ok({ daysUsed, days, balance, balanceAfter: balance ? balance.available - daysUsed : null });
}

export async function createRequest(db: DB, actor: Actor, input: RequestInput): Promise<Result<string>> {
  const preview = await previewRequest(db, actor.id, input);
  if (!preview.ok) return preview;
  // Sick leave beyond the allowance still goes to the manager (with a medical report); annual can't go negative.
  if (preview.value.balanceAfter !== null && preview.value.balanceAfter < 0 && preview.value.balance?.type === 'annual') {
    return fail('insufficient_balance');
  }
  const r = parse(requestInput, input);
  if (!r.ok) return r;
  const [row] = await db
    .insert(leaveRequests)
    .values({ employeeId: actor.id, ...r.value, daysUsed: preview.value.daysUsed })
    .returning();
  await audit(db, { actorId: actor.id, action: 'create', entity: 'leave_request', entityId: row!.id, after: row });
  return ok(row!.id);
}

function canDecide(actor: Actor, employee: Pick<Employee, 'id' | 'managerId'>) {
  if (actor.id === employee.id) return false;
  return employee.managerId === actor.id || (!employee.managerId && actor.roles.includes('admin'));
}

/** Months that are submitted or approved can't take new leave; the manager must return them first. */
async function lockedMonths(db: DB, employeeId: string, dates: string[]): Promise<boolean> {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const rows = await db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.employeeId, employeeId), inArray(timesheets.status, ['submitted', 'approved'])));
  return rows.some((t) => months.includes(`${t.year}-${String(t.month).padStart(2, '0')}`));
}

export async function decideRequest(
  db: DB,
  actor: Actor,
  requestId: string,
  outcome: 'approve' | 'decline',
  note: string | null,
): Promise<Result<void>> {
  const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, requestId));
  if (!req) return fail('not_found');
  const [employee] = await db.select().from(employees).where(eq(employees.id, req.employeeId));
  if (!employee || !canDecide(actor, employee)) return fail('forbidden');
  if (req.status !== 'pending') return fail('invalid_input', 'already decided');

  if (outcome === 'decline') {
    const [after] = await db
      .update(leaveRequests)
      .set({ status: 'declined', decidedById: actor.id, decidedAt: new Date(), managerNote: note })
      .where(eq(leaveRequests.id, requestId))
      .returning();
    await audit(db, { actorId: actor.id, action: 'decline', entity: 'leave_request', entityId: requestId, before: req, after });
    return ok(undefined);
  }

  const ctx = await loadRulesContext(db);
  const workdays = eachDay(req.fromDate, req.toDate)
    .map((d) => resolveDay(ctx, req.employeeId, d))
    .filter((d) => isWorkday(d.dayType));
  if (await lockedMonths(db, req.employeeId, workdays.map((d) => d.date))) return fail('month_locked');

  await db.transaction(async (tx) => {
    // Approved leave goes straight onto the timesheet.
    for (const d of workdays) {
      const values = {
        employeeId: req.employeeId,
        date: d.date,
        workedMinutes: req.halfDay ? Math.round(d.expectedMinutes / 2) : 0,
        startTime: null,
        endTime: null,
        leaveType: req.type,
        leavePortion: req.halfDay ? 0.5 : 1,
        note: req.note,
      };
      const where = and(eq(dayEntries.employeeId, req.employeeId), eq(dayEntries.date, d.date));
      const [existing] = await tx.select().from(dayEntries).where(where);
      if (existing) await tx.update(dayEntries).set(values).where(where);
      else await tx.insert(dayEntries).values(values);
    }
    const [after] = await tx
      .update(leaveRequests)
      .set({ status: 'approved', decidedById: actor.id, decidedAt: new Date(), managerNote: note })
      .where(eq(leaveRequests.id, requestId))
      .returning();
    await audit(tx, { actorId: actor.id, action: 'approve', entity: 'leave_request', entityId: requestId, before: req, after });
  });
  return ok(undefined);
}

/** The person can cancel a pending request, or approved leave that hasn't started yet. */
export async function cancelRequest(db: DB, actor: Actor, requestId: string, today = todayISO()): Promise<Result<void>> {
  const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, requestId));
  if (!req) return fail('not_found');
  if (req.employeeId !== actor.id) return fail('forbidden');
  const cancellable = req.status === 'pending' || (req.status === 'approved' && req.fromDate > today);
  if (!cancellable) return fail('invalid_input', 'this leave can no longer be cancelled');

  await db.transaction(async (tx) => {
    if (req.status === 'approved') {
      // Take it back off the timesheet (only days still showing this leave).
      await tx
        .delete(dayEntries)
        .where(
          and(
            eq(dayEntries.employeeId, req.employeeId),
            gte(dayEntries.date, req.fromDate),
            lte(dayEntries.date, req.toDate),
            eq(dayEntries.leaveType, req.type),
          ),
        );
    }
    const [after] = await tx.update(leaveRequests).set({ status: 'cancelled' }).where(eq(leaveRequests.id, requestId)).returning();
    await audit(tx, { actorId: actor.id, action: 'cancel', entity: 'leave_request', entityId: requestId, before: req, after });
  });
  return ok(undefined);
}

export async function listRequests(db: DB, employeeId: string): Promise<LeaveRequestRow[]> {
  return db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.fromDate));
}

function reportsOf(people: Employee[], actor: Actor) {
  return people.filter((p) => canDecide(actor, p));
}

export async function listPendingLeave(db: DB, actor: Actor): Promise<(LeaveRequestRow & { employee: Employee })[]> {
  const people = await db.select().from(employees);
  const mine = reportsOf(people, actor);
  if (!mine.length) return [];
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.status, 'pending'), inArray(leaveRequests.employeeId, mine.map((p) => p.id))))
    .orderBy(asc(leaveRequests.createdAt));
  return rows.map((r) => ({ ...r, employee: mine.find((p) => p.id === r.employeeId)! }));
}

export async function countPendingLeave(db: DB, actor: Actor): Promise<number> {
  const people = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees);
  const ids = people.filter((p) => canDecide(actor, p)).map((p) => p.id);
  if (!ids.length) return 0;
  const rows = await db
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.status, 'pending'), inArray(leaveRequests.employeeId, ids)));
  return rows.length;
}

/** Teammates (same manager) with approved or pending leave overlapping these dates — for coverage. */
export async function teamOff(db: DB, employeeId: string, from: string, to: string) {
  const [me] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!me?.managerId) return [];
  const team = await db
    .select()
    .from(employees)
    .where(and(eq(employees.managerId, me.managerId), ne(employees.id, employeeId), eq(employees.active, true)));
  if (!team.length) return [];
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.employeeId, team.map((p) => p.id)),
        inArray(leaveRequests.status, ['pending', 'approved']),
        lte(leaveRequests.fromDate, to),
        gte(leaveRequests.toDate, from),
      ),
    );
  return rows.map((r) => ({ ...r, employee: team.find((p) => p.id === r.employeeId)! }));
}

export const adjustmentInput = z.object({
  employeeId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  type: z.enum(TRACKED_TYPES),
  days: z.coerce.number().min(-100).max(100).refine((n) => n !== 0 && Number.isInteger(n * 2), 'whole or half days'),
  reason: z.string().trim().min(1).max(200),
});

export async function addAdjustment(db: DB, actorId: string, input: z.input<typeof adjustmentInput>): Promise<Result<void>> {
  const parsed = parse(adjustmentInput, input);
  if (!parsed.ok) return parsed;
  if (!(await db.select().from(employees).where(eq(employees.id, parsed.value.employeeId))).length) return fail('not_found');
  const [row] = await db.insert(leaveAdjustments).values({ ...parsed.value, createdById: actorId }).returning();
  await audit(db, { actorId, action: 'create', entity: 'leave_adjustment', entityId: row!.id, after: row });
  return ok(undefined);
}

export async function listAdjustments(db: DB, employeeId: string, year: number) {
  return db
    .select()
    .from(leaveAdjustments)
    .where(and(eq(leaveAdjustments.employeeId, employeeId), eq(leaveAdjustments.year, year)))
    .orderBy(asc(leaveAdjustments.createdAt));
}
