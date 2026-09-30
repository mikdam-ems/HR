import { cache } from 'react';
import { and, asc, between, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import {
  dayChangeRequests,
  dayEntries,
  employees,
  monthClosures,
  timesheets,
  type DayChangeRow,
  type Employee,
  type TimesheetRow,
} from '@/db/schema';
import {
  type DayEntry,
  type LeaveType,
  type MonthSummary,
  daysOfMonth,
  monthUsesClock,
  summarizeMonth,
  windowMinutes,
} from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { approversOf, notify } from './notify';
import { behalfOf } from './delegation';
import { type Approver, decidesFor } from './permissions';
import { firstClockDates, monthClock, toClockedMonth } from './clock';
import { loadRulesContext } from './rulesContext';
import { getSettings } from './settings';
import { type Result, fail, hhmm, isoDate, ok, parse } from './validation';

export type Actor = Approver;

export interface TimesheetAccess {
  view: boolean;
  /** The person themselves, while the month is a draft or was returned. */
  edit: boolean;
  /** Their direct manager (or an admin when they have no manager), never themselves. */
  decide: boolean;
}

const EDITABLE = new Set(['draft', 'returned']);

/** True once HR has closed the month for payroll. */
export async function isMonthClosed(db: DB, year: number, month: number): Promise<boolean> {
  const rows = await db
    .select({ id: monthClosures.id })
    .from(monthClosures)
    .where(and(eq(monthClosures.year, year), eq(monthClosures.month, month)));
  return rows.length > 0;
}

export function accessFor(
  actor: Actor,
  employee: Pick<Employee, 'id' | 'managerId'>,
  status: string,
  closed = false,
): TimesheetAccess {
  const self = actor.id === employee.id;
  const decider = decidesFor(actor, employee);
  const staff = actor.roles.some((r) => r === 'hr' || r === 'admin' || r === 'finance');
  return {
    view: self || decider || staff,
    edit: self && EDITABLE.has(status) && !closed,
    decide: decider && status === 'submitted' && !closed,
  };
}

/**
 * Who can see someone's attendance log (every clock in, break and out): the person, their manager, and
 * HR, Finance and admins — the same people who see their timesheet (README, "Who can do what").
 */
export function canViewAttendance(actor: Actor, employee: Pick<Employee, 'id' | 'managerId'>): boolean {
  return accessFor(actor, employee, 'draft').view;
}

export interface MonthView {
  employee: Employee;
  year: number;
  month: number;
  /** Stored row, or null for a month nobody has touched yet (a draft). */
  timesheet: TimesheetRow | null;
  status: TimesheetRow['status'];
  /** HR closed this month for payroll; nothing can change. */
  closed: boolean;
  summary: MonthSummary;
  notes: Record<string, string>;
  times: Record<string, { start: string | null; end: string | null }>;
  /** Day changes waiting for the manager, by date. */
  pending: Record<string, DayChangeRow>;
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
  const closed = await isMonthClosed(db, year, month);
  const access = accessFor(actor, employee, status, closed);
  if (!access.view) return fail('forbidden');

  const [from, to] = monthRange(year, month);
  const [ctx, appSettings, rows, requests] = await Promise.all([
    loadRulesContext(db),
    getSettings(db),
    db
      .select()
      .from(dayEntries)
      .where(and(eq(dayEntries.employeeId, employeeId), between(dayEntries.date, from, to)))
      .orderBy(asc(dayEntries.date)),
    db
      .select()
      .from(dayChangeRequests)
      .where(
        and(
          eq(dayChangeRequests.employeeId, employeeId),
          eq(dayChangeRequests.status, 'pending'),
          between(dayChangeRequests.date, from, to),
        ),
      ),
  ]);
  const pending = Object.fromEntries(requests.map((r) => [r.date, r]));

  const entries: DayEntry[] = rows.map((r) => ({
    date: r.date,
    workedMinutes: r.workedMinutes,
    ...(r.leaveType ? { leave: { type: r.leaveType, portion: r.leavePortion === 0.5 ? 0.5 : 1 } } : {}),
  }));
  const notes = Object.fromEntries(rows.filter((r) => r.note).map((r) => [r.date, r.note!]));
  const times = Object.fromEntries(rows.map((r) => [r.date, { start: r.startTime, end: r.endTime }]));
  const periods = appSettings.hoursSource;
  const clockSource = monthUsesClock(periods, year, month)
      ? await Promise.all([monthClock(db, employeeId, year, month), firstClockDates(db, [employeeId])]).then(([days, since]) => ({
          ...toClockedMonth(days),
          today: todayISO(),
          since: since[employeeId] ?? null,
          periods,
        }))
      : undefined;
  const summary = summarizeMonth(ctx, employeeId, year, month, entries, appSettings.overtimeRates, clockSource);
  // A note alone is worth the manager's attention, even if the hours match.
  for (const d of summary.days) if (notes[d.day.date]) d.changed = true;

  return ok({ employee, year, month, timesheet, status, closed, summary, notes, times, pending, access });
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

/** Who decides a person's requests: see decidesFor (manager, their stand-in, or an admin when there's no manager). */
export function canDecideFor(actor: Actor, employee: Pick<Employee, 'id' | 'managerId'>): boolean {
  return decidesFor(actor, employee);
}

type DayValues = Pick<DayChangeRow, 'workedMinutes' | 'startTime' | 'endTime' | 'leaveType' | 'leavePortion' | 'note'>;

const sameDay = (a: DayValues, b: DayValues) =>
  a.workedMinutes === b.workedMinutes &&
  a.startTime === b.startTime &&
  a.endTime === b.endTime &&
  a.leaveType === b.leaveType &&
  (a.leavePortion ?? null) === (b.leavePortion ?? null) &&
  a.note === b.note;

/** Writes a day's change onto the timesheet, or (values = null) takes the day back to its schedule. */
async function applyDay(db: DB, actorId: string, employeeId: string, date: string, values: DayValues | null) {
  const where = and(eq(dayEntries.employeeId, employeeId), eq(dayEntries.date, date));
  const [before] = await db.select().from(dayEntries).where(where);
  if (!values) {
    if (before) {
      await db.delete(dayEntries).where(where);
      await audit(db, { actorId, action: 'reset', entity: 'day_entry', entityId: before.id, before });
    }
    return;
  }
  const [after] = before
    ? await db.update(dayEntries).set(values).where(where).returning()
    : await db.insert(dayEntries).values({ employeeId, date, ...values }).returning();
  await audit(db, { actorId, action: before ? 'update' : 'create', entity: 'day_entry', entityId: after!.id, before, after });
}

async function findPendingChange(db: DB, employeeId: string, date: string) {
  const [row] = await db
    .select()
    .from(dayChangeRequests)
    .where(and(eq(dayChangeRequests.employeeId, employeeId), eq(dayChangeRequests.date, date), eq(dayChangeRequests.status, 'pending')));
  return row;
}

/** Files (or replaces, or withdraws) the one pending request for this day. */
async function requestChange(
  db: DB,
  actorId: string,
  employeeId: string,
  date: string,
  change: { action: 'set' | 'reset'; values: DayValues } | null,
): Promise<string | null> {
  const pending = await findPendingChange(db, employeeId, date);
  if (!change) {
    if (pending) {
      const [after] = await db.update(dayChangeRequests).set({ status: 'cancelled' }).where(eq(dayChangeRequests.id, pending.id)).returning();
      await audit(db, { actorId, action: 'cancel', entity: 'day_change', entityId: pending.id, before: pending, after });
    }
    return null;
  }
  const values = { action: change.action, ...change.values };
  const [after] = pending
    ? await db.update(dayChangeRequests).set(values).where(eq(dayChangeRequests.id, pending.id)).returning()
    : await db.insert(dayChangeRequests).values({ employeeId, date, ...values }).returning();
  await audit(db, { actorId, action: pending ? 'update' : 'request', entity: 'day_change', entityId: after!.id, before: pending, after });
  if (!pending) {
    const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
    if (employee) await notify(db, await approversOf(db, employee), 'day_change_requested', { name: employee.nameEn, nameAr: employee.nameAr, date }, '/approvals');
  }
  return after!.id;
}

export interface SaveOutcome {
  /** True when the change went straight onto the timesheet (people with no manager). */
  applied: boolean;
  /** The pending request for the manager, if one was filed. */
  requestId: string | null;
}

/**
 * Records how a day went. For anyone with a manager this files a change request; the timesheet changes
 * only once the manager approves it. Saving a day back to exactly how it stands withdraws the request.
 */
export async function saveDay(db: DB, actor: Actor, employeeId: string, input: DayInput): Promise<Result<SaveOutcome>> {
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

  const [before] = await db.select().from(dayEntries).where(and(eq(dayEntries.employeeId, employeeId), eq(dayEntries.date, d.date)));
  // What the day shows without any change: the clocked time (clock mode) or the schedule.
  const monthDay = view.value.summary.days.find((x) => x.day.date === d.date)!;
  const scheduled =
    monthDay.source === 'clock'
      ? (monthDay.clockedMinutes ?? 0)
      : day.dayType === 'working' || day.dayType === 'special_overtime'
        ? day.expectedMinutes
        : 0;
  const asScheduled = worked === scheduled && !d.leaveType && !d.note;
  const values: DayValues = {
    workedMinutes: worked,
    startTime: fullLeave ? null : d.startTime,
    endTime: fullLeave ? null : d.endTime,
    leaveType: d.leaveType as LeaveType | null,
    leavePortion: d.leaveType ? d.leavePortion : null,
    note: d.note,
  };

  if (!view.value.employee.managerId) {
    await applyDay(db, actor.id, employeeId, d.date, asScheduled ? null : values);
    return ok({ applied: true, requestId: null });
  }
  // Nothing would change: withdraw any request for this day.
  const unchanged = asScheduled ? !before : !!before && sameDay(before, values);
  const requestId = await requestChange(
    db,
    actor.id,
    employeeId,
    d.date,
    unchanged ? null : { action: asScheduled ? 'reset' : 'set', values },
  );
  return ok({ applied: false, requestId });
}

/** Asks to take a day back to its schedule (or withdraws a pending change). */
export async function resetDay(db: DB, actor: Actor, employeeId: string, date: string): Promise<Result<SaveOutcome>> {
  const d = parse(isoDate, date);
  if (!d.ok) return d;
  const view = await getMonth(db, actor, employeeId, Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  if (!view.ok) return view;
  if (!view.value.access.edit) return fail('forbidden');
  if (!view.value.employee.managerId) {
    await applyDay(db, actor.id, employeeId, date, null);
    return ok({ applied: true, requestId: null });
  }
  const [entry] = await db.select().from(dayEntries).where(and(eq(dayEntries.employeeId, employeeId), eq(dayEntries.date, date)));
  const empty: DayValues = { workedMinutes: 0, startTime: null, endTime: null, leaveType: null, leavePortion: null, note: null };
  const requestId = await requestChange(db, actor.id, employeeId, date, entry ? { action: 'reset', values: empty } : null);
  return ok({ applied: false, requestId });
}

/** The manager approves (the day changes on the timesheet) or declines (nothing changes) a day change. */
export async function decideDayChange(
  db: DB,
  actor: Actor,
  requestId: string,
  outcome: 'approve' | 'decline',
  note: string | null = null,
): Promise<Result<void>> {
  const [req] = await db.select().from(dayChangeRequests).where(eq(dayChangeRequests.id, requestId));
  if (!req) return fail('not_found');
  const [employee] = await db.select().from(employees).where(eq(employees.id, req.employeeId));
  if (!employee || !canDecideFor(actor, employee)) return fail('forbidden');
  if (req.status !== 'pending') return fail('already_decided');
  const behalf = await behalfOf(db, actor, employee);
  const year = Number(req.date.slice(0, 4));
  const month = Number(req.date.slice(5, 7));
  const sheet = await findTimesheet(db, req.employeeId, year, month);
  if ((sheet && !EDITABLE.has(sheet.status)) || (await isMonthClosed(db, year, month))) return fail('month_locked');

  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    if (outcome === 'approve') {
      const { workedMinutes, startTime, endTime, leaveType, leavePortion, note: dayNote } = req;
      await applyDay(t, actor.id, req.employeeId, req.date, req.action === 'reset' ? null : { workedMinutes, startTime, endTime, leaveType, leavePortion, note: dayNote });
    }
    const [after] = await t
      .update(dayChangeRequests)
      .set({ status: outcome === 'approve' ? 'approved' : 'declined', decidedById: actor.id, decidedAt: new Date(), managerNote: note })
      .where(eq(dayChangeRequests.id, requestId))
      .returning();
    await audit(t, {
      actorId: actor.id,
      action: outcome,
      entity: 'day_change',
      entityId: requestId,
      before: req,
      after: { ...after, ...(behalf ? { onBehalfOf: behalf.managerId } : {}) },
    });
  });
  await notify(
    db,
    [req.employeeId],
    'day_change_decided',
    { outcome: outcome === 'approve' ? 'approved' : 'declined', date: req.date, note, ...(behalf?.data ?? {}) },
    `/timesheet/${req.employeeId}?month=${req.date.slice(0, 7)}&day=${req.date}`,
  );
  return ok(undefined);
}

export interface PendingChange {
  request: DayChangeRow;
  employee: Employee;
  /** How the day stands on the timesheet now (null = as scheduled). */
  current: { workedMinutes: number; leaveType: LeaveType | null } | null;
}

/** Day changes waiting for this person to decide, oldest first. */
export async function listPendingDayChanges(db: DB, actor: Actor): Promise<PendingChange[]> {
  const people = (await db.select().from(employees)).filter((p) => canDecideFor(actor, p));
  if (!people.length) return [];
  const ids = people.map((p) => p.id);
  const rows = await db
    .select()
    .from(dayChangeRequests)
    .where(and(eq(dayChangeRequests.status, 'pending'), inArray(dayChangeRequests.employeeId, ids)))
    .orderBy(asc(dayChangeRequests.date));
  if (!rows.length) return [];
  const entries = await db.select().from(dayEntries).where(inArray(dayEntries.employeeId, ids));
  return rows.map((r) => {
    const e = entries.find((x) => x.employeeId === r.employeeId && x.date === r.date);
    return {
      request: r,
      employee: people.find((p) => p.id === r.employeeId)!,
      current: e ? { workedMinutes: e.workedMinutes, leaveType: e.leaveType } : null,
    };
  });
}

/** The person withdraws their own pending day change. */
export async function cancelDayChange(db: DB, actor: Actor, requestId: string): Promise<Result<void>> {
  const [req] = await db.select().from(dayChangeRequests).where(eq(dayChangeRequests.id, requestId));
  if (!req) return fail('not_found');
  if (req.employeeId !== actor.id) return fail('forbidden');
  if (req.status !== 'pending') return fail('already_decided');
  await requestChange(db, actor.id, req.employeeId, req.date, null);
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
  if (Object.keys(view.value.pending).length) return fail('pending_changes');

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
  await notify(
    db,
    await approversOf(db, view.value.employee),
    'month_submitted',
    { name: view.value.employee.nameEn, nameAr: view.value.employee.nameAr, month: `${year}-${String(month).padStart(2, '0')}` },
    `/approvals?t=${after!.id}`,
  );
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
  // A double click or a second tab: say so plainly rather than "forbidden".
  if (before.status !== 'submitted') return fail('already_decided');
  const view = await getMonth(db, actor, before.employeeId, before.year, before.month);
  if (!view.ok) return view;
  if (!view.value.access.decide) return fail('forbidden');
  if (outcome === 'returned' && !note) return fail('invalid_input', 'a note is required when returning');
  const behalf = await behalfOf(db, actor, view.value.employee);

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
  await audit(db, {
    actorId: actor.id,
    action: outcome === 'approved' ? 'approve' : 'return',
    entity: 'timesheet',
    entityId: timesheetId,
    before,
    after: { ...after, ...(behalf ? { onBehalfOf: behalf.managerId } : {}) },
  });
  const monthKey = `${before.year}-${String(before.month).padStart(2, '0')}`;
  await notify(
    db,
    [before.employeeId],
    'month_decided',
    { outcome, month: monthKey, note, ...(behalf?.data ?? {}) },
    `/timesheet/${before.employeeId}?month=${monthKey}`,
  );
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
  const mine = people.filter((p) => canDecideFor(actor, p));
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


/** How many submitted timesheets and day changes wait for this person — cheap enough for the navigation badge. */
async function countPendingApprovalsUncached(db: DB, actor: Actor): Promise<number> {
  const people = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees);
  const ids = people.filter((p) => canDecideFor(actor, p)).map((p) => p.id);
  if (!ids.length) return 0;
  const [sheets, changes] = await Promise.all([
    db.select({ id: timesheets.id }).from(timesheets).where(and(eq(timesheets.status, 'submitted'), inArray(timesheets.employeeId, ids))),
    db
      .select({ id: dayChangeRequests.id })
      .from(dayChangeRequests)
      .where(and(eq(dayChangeRequests.status, 'pending'), inArray(dayChangeRequests.employeeId, ids))),
  ]);
  return sheets.length + changes.length;
}

/** Loaded once per page render and shared by everything on the page. */
export const countPendingApprovals = cache(countPendingApprovalsUncached);
