import { and, asc, between, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { dayEntries, employees, timesheets, type Employee, type Role, type TimesheetRow } from '@/db/schema';
import {
  type DayEntry,
  type LeaveType,
  type MonthSummary,
  daysOfMonth,
  summarizeMonth,
  windowMinutes,
} from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { loadRulesContext } from './rulesContext';
import { getSettings } from './settings';
import { type Result, fail, hhmm, isoDate, ok, parse } from './validation';

export interface Actor {
  id: string;
  roles: Role[];
}

export interface TimesheetAccess {
  view: boolean;
  /** The person themselves, while the month is a draft or was returned. */
  edit: boolean;
  /** Their direct manager (or an admin when they have no manager), never themselves. */
  decide: boolean;
}

const EDITABLE = new Set(['draft', 'returned']);

export function accessFor(actor: Actor, employee: Pick<Employee, 'id' | 'managerId'>, status: string): TimesheetAccess {
  const self = actor.id === employee.id;
  const manager = employee.managerId === actor.id;
  const adminFallback = !employee.managerId && actor.roles.includes('admin');
  const staff = actor.roles.some((r) => r === 'hr' || r === 'admin' || r === 'finance');
  return {
    view: self || manager || staff,
    edit: self && EDITABLE.has(status),
    decide: !self && (manager || adminFallback) && status === 'submitted',
  };
}

export interface MonthView {
  employee: Employee;
  year: number;
  month: number;
  /** Stored row, or null for a month nobody has touched yet (a draft). */
  timesheet: TimesheetRow | null;
  status: TimesheetRow['status'];
  summary: MonthSummary;
  notes: Record<string, string>;
  times: Record<string, { start: string | null; end: string | null }>;
  access: TimesheetAccess;
}

const monthRange = (year: number, month: number) => {
  const days = daysOfMonth(year, month);
  return [days[0]!, days[days.length - 1]!] as const;
};

async function findTimesheet(db: DB, employeeId: string, year: number, month: number) {
  const [row] = await db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.employeeId, employeeId), eq(timesheets.year, year), eq(timesheets.month, month)));
  return row ?? null;
}

/** Everything a timesheet screen needs: every day resolved, the person's changes applied, totals and checks. */
export async function getMonth(
  db: DB,
  actor: Actor,
  employeeId: string,
  year: number,
  month: number,
): Promise<Result<MonthView>> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return fail('invalid_input');
  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee) return fail('not_found');
  const timesheet = await findTimesheet(db, employeeId, year, month);
  const status = timesheet?.status ?? 'draft';
  const access = accessFor(actor, employee, status);
  if (!access.view) return fail('forbidden');

  const [from, to] = monthRange(year, month);
  const [ctx, appSettings, rows] = await Promise.all([
    loadRulesContext(db),
    getSettings(db),
    db
      .select()
      .from(dayEntries)
      .where(and(eq(dayEntries.employeeId, employeeId), between(dayEntries.date, from, to)))
      .orderBy(asc(dayEntries.date)),
  ]);

  const entries: DayEntry[] = rows.map((r) => ({
    date: r.date,
    workedMinutes: r.workedMinutes,
    ...(r.leaveType ? { leave: { type: r.leaveType, portion: r.leavePortion === 0.5 ? 0.5 : 1 } } : {}),
  }));
  const notes = Object.fromEntries(rows.filter((r) => r.note).map((r) => [r.date, r.note!]));
  const times = Object.fromEntries(rows.map((r) => [r.date, { start: r.startTime, end: r.endTime }]));
  const summary = summarizeMonth(ctx, employeeId, year, month, entries, appSettings.overtimeRates);
  // A note alone is worth the manager's attention, even if the hours match.
  for (const d of summary.days) if (notes[d.day.date]) d.changed = true;

  return ok({ employee, year, month, timesheet, status, summary, notes, times, access });
}

export const dayInput = z.object({
  date: isoDate,
  startTime: hhmm.nullish().transform((v) => v ?? null),
  endTime: hhmm.nullish().transform((v) => v ?? null),
  /** Used when no start/end is given. */
  workedMinutes: z.coerce.number().int().min(0).max(24 * 60).nullish(),
  leaveType: z
    .enum(['annual', 'sick', 'maternity', 'paternity', 'bereavement', 'hajj', 'unpaid', 'compensatory'])
    .nullish()
    .transform((v) => v ?? null),
  leavePortion: z.union([z.literal(1), z.literal(0.5)]).default(1),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type DayInput = z.input<typeof dayInput>;

/** Records how a day went. Saving a day back to exactly its schedule (no leave, no note) removes the change. */
export async function saveDay(db: DB, actor: Actor, employeeId: string, input: DayInput): Promise<Result<void>> {
  const parsed = parse(dayInput, input);
  if (!parsed.ok) return parsed;
  const d = parsed.value;
  const year = Number(d.date.slice(0, 4));
  const month = Number(d.date.slice(5, 7));

  const view = await getMonth(db, actor, employeeId, year, month);
  if (!view.ok) return view;
  if (!view.value.access.edit) return fail('forbidden');
  const day = view.value.summary.days.find((x) => x.day.date === d.date)!.day;

  let worked: number;
  const fullLeave = !!d.leaveType && d.leavePortion === 1;
  if (fullLeave) {
    // A full day of leave means no work, whatever the time fields still show.
    worked = 0;
  } else if (d.startTime && d.endTime) {
    worked = Math.max(0, windowMinutes(d.startTime, d.endTime) - (day.schedule?.breakMinutes ?? 0));
  } else if (d.workedMinutes !== null && d.workedMinutes !== undefined) {
    worked = d.workedMinutes;
  } else {
    worked = day.expectedMinutes;
  }

  const where = and(eq(dayEntries.employeeId, employeeId), eq(dayEntries.date, d.date));
  const [before] = await db.select().from(dayEntries).where(where);
  const scheduled = day.dayType === 'working' || day.dayType === 'special_overtime' ? day.expectedMinutes : 0;
  const asScheduled = worked === scheduled && !d.leaveType && !d.note;

  if (asScheduled) {
    if (before) {
      await db.delete(dayEntries).where(where);
      await audit(db, { actorId: actor.id, action: 'reset', entity: 'day_entry', entityId: before.id, before });
    }
    return ok(undefined);
  }

  const values = {
    employeeId,
    date: d.date,
    workedMinutes: worked,
    startTime: fullLeave ? null : d.startTime,
    endTime: fullLeave ? null : d.endTime,
    leaveType: d.leaveType as LeaveType | null,
    leavePortion: d.leaveType ? d.leavePortion : null,
    note: d.note,
  };
  const [after] = before
    ? await db.update(dayEntries).set(values).where(where).returning()
    : await db.insert(dayEntries).values(values).returning();
  await audit(db, { actorId: actor.id, action: before ? 'update' : 'create', entity: 'day_entry', entityId: after!.id, before, after });
  return ok(undefined);
}

export async function resetDay(db: DB, actor: Actor, employeeId: string, date: string): Promise<Result<void>> {
  const d = parse(isoDate, date);
  if (!d.ok) return d;
  const view = await getMonth(db, actor, employeeId, Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  if (!view.ok) return view;
  if (!view.value.access.edit) return fail('forbidden');
  const [before] = await db
    .delete(dayEntries)
    .where(and(eq(dayEntries.employeeId, employeeId), eq(dayEntries.date, date)))
    .returning();
  if (before) await audit(db, { actorId: actor.id, action: 'reset', entity: 'day_entry', entityId: before.id, before });
  return ok(undefined);
}

export async function submitMonth(
  db: DB,
  actor: Actor,
  employeeId: string,
  year: number,
  month: number,
  today = todayISO(),
): Promise<Result<void>> {
  const view = await getMonth(db, actor, employeeId, year, month);
  if (!view.ok) return view;
  if (!view.value.access.edit) return fail('forbidden');
  if (monthRange(year, month)[0] > today) return fail('month_not_started');

  const values = {
    status: 'submitted' as const,
    submittedAt: new Date(),
    decidedById: null,
    decidedAt: null,
    totals: view.value.summary.totals,
  };
  const before = view.value.timesheet;
  const [after] = before
    ? await db.update(timesheets).set(values).where(eq(timesheets.id, before.id)).returning()
    : await db.insert(timesheets).values({ employeeId, year, month, ...values }).returning();
  await audit(db, { actorId: actor.id, action: 'submit', entity: 'timesheet', entityId: after!.id, before, after });
  return ok(undefined);
}

async function decide(
  db: DB,
  actor: Actor,
  timesheetId: string,
  outcome: 'approved' | 'returned',
  note: string | null,
): Promise<Result<void>> {
  const [before] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId));
  if (!before) return fail('not_found');
  const view = await getMonth(db, actor, before.employeeId, before.year, before.month);
  if (!view.ok) return view;
  if (!view.value.access.decide) return fail('forbidden');
  if (outcome === 'returned' && !note) return fail('invalid_input', 'a note is required when returning');

  const [after] = await db
    .update(timesheets)
    .set({
      status: outcome,
      decidedById: actor.id,
      decidedAt: new Date(),
      managerNote: note,
      totals: view.value.summary.totals,
    })
    .where(eq(timesheets.id, timesheetId))
    .returning();
  await audit(db, { actorId: actor.id, action: outcome === 'approved' ? 'approve' : 'return', entity: 'timesheet', entityId: timesheetId, before, after });
  return ok(undefined);
}

export const approveMonth = (db: DB, actor: Actor, timesheetId: string, note: string | null = null) =>
  decide(db, actor, timesheetId, 'approved', note);

export const returnMonth = (db: DB, actor: Actor, timesheetId: string, note: string | null) =>
  decide(db, actor, timesheetId, 'returned', note);

export interface PendingItem {
  timesheet: TimesheetRow;
  employee: Employee;
  changedDays: number;
  issues: number;
}

/** Submitted timesheets waiting for this person: their direct reports (plus, for admins, people with no manager). */
export async function listPendingApprovals(db: DB, actor: Actor): Promise<PendingItem[]> {
  const people = await db.select().from(employees);
  const mine = people.filter(
    (p) => p.id !== actor.id && (p.managerId === actor.id || (!p.managerId && actor.roles.includes('admin'))),
  );
  if (!mine.length) return [];
  const rows = await db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.status, 'submitted'), inArray(timesheets.employeeId, mine.map((p) => p.id))))
    .orderBy(asc(timesheets.submittedAt));

  const items: PendingItem[] = [];
  for (const t of rows) {
    const view = await getMonth(db, actor, t.employeeId, t.year, t.month);
    if (!view.ok) continue;
    items.push({
      timesheet: t,
      employee: view.value.employee,
      changedDays: view.value.summary.days.filter((d) => d.changed).length,
      issues: view.value.summary.issues.length,
    });
  }
  return items;
}

/** The status of one month for the Home screen, without computing the whole month. */
export async function monthStatus(db: DB, employeeId: string, year: number, month: number) {
  return (await findTimesheet(db, employeeId, year, month))?.status ?? 'draft';
}


/** How many submitted timesheets wait for this person — cheap enough for the navigation badge. */
export async function countPendingApprovals(db: DB, actor: Actor): Promise<number> {
  const people = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees);
  const ids = people
    .filter((p) => p.id !== actor.id && (p.managerId === actor.id || (!p.managerId && actor.roles.includes('admin'))))
    .map((p) => p.id);
  if (!ids.length) return 0;
  const rows = await db
    .select({ id: timesheets.id })
    .from(timesheets)
    .where(and(eq(timesheets.status, 'submitted'), inArray(timesheets.employeeId, ids)));
  return rows.length;
}
