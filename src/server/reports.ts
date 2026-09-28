import { and, between, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { dayEntries, departments, employees, monthClosures, timesheets, type Department, type Employee, type TimesheetRow } from '@/db/schema';
import { type DayEntry, type MonthSummary, type MonthTotals, daysOfMonth, sumMonthDays, summarizeMonth } from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { firstClockDates, monthClockMinutes } from './clock';
import { can, type CurrentUser } from './permissions';
import { notify } from './notify';
import { loadRulesContext } from './rulesContext';
import { getSettings } from './settings';
import type { AttendanceMonth } from './attendance';
import { buildTimesheetWorkbook } from './timesheetWorkbook';
import { isMonthClosed } from './timesheets';
import { type Result, fail, ok } from './validation';

export interface ReportRow {
  employee: Employee;
  manager: Employee | null;
  department: Department | null;
  clients: string[];
  status: TimesheetRow['status'];
  /** Frozen totals once approved, so the report matches what the manager signed off. */
  totals: MonthTotals;
  summary: MonthSummary;
  notes: Record<string, string>;
}

export interface MonthReport {
  year: number;
  month: number;
  closed: boolean;
  closedAt: Date | null;
  rows: ReportRow[];
  /** People whose timesheet is not approved yet — they block closing the month. */
  notApproved: ReportRow[];
}

type Actor = Pick<CurrentUser, 'id' | 'roles'>;

/** Everyone with a client assignment during the month, with their totals. One rules load for the whole team. */
export async function monthReport(db: DB, actor: Actor, year: number, month: number): Promise<Result<MonthReport>> {
  if (!can(actor, 'reports.view')) return fail('forbidden');
  const days = daysOfMonth(year, month);
  const [ctx, appSettings, people, entries, sheets, closures, depts, clocked, since] = await Promise.all([
    loadRulesContext(db),
    getSettings(db),
    db.select().from(employees),
    db.select().from(dayEntries).where(between(dayEntries.date, days[0]!, days[days.length - 1]!)),
    db.select().from(timesheets).where(and(eq(timesheets.year, year), eq(timesheets.month, month))),
    db.select().from(monthClosures).where(and(eq(monthClosures.year, year), eq(monthClosures.month, month))),
    db.select().from(departments),
    monthClockMinutes(db, year, month),
    firstClockDates(db),
  ]);
  const today = todayISO();
  const deptById = new Map(depts.map((d) => [d.id, d]));
  const byId = new Map(people.map((p) => [p.id, p]));

  const rows: ReportRow[] = [];
  for (const employee of people.filter((p) => p.active).sort((a, b) => a.nameEn.localeCompare(b.nameEn))) {
    const mine = entries.filter((e) => e.employeeId === employee.id);
    const dayEntryList: DayEntry[] = mine.map((r) => ({
      date: r.date,
      workedMinutes: r.workedMinutes,
      ...(r.leaveType ? { leave: { type: r.leaveType, portion: r.leavePortion === 0.5 ? 0.5 : 1 } } : {}),
    }));
    const summary = summarizeMonth(
      ctx,
      employee.id,
      year,
      month,
      dayEntryList,
      appSettings.overtimeRates,
      appSettings.hoursSource === 'clock'
        ? { ...(clocked[employee.id] ?? { minutes: {}, open: [] }), today, since: since[employee.id] ?? null }
        : undefined,
    );
    if (summary.days.every((d) => d.day.dayType === 'unassigned')) continue; // not working for anyone this month
    const notes = Object.fromEntries(mine.filter((r) => r.note).map((r) => [r.date, r.note!]));
    for (const d of summary.days) if (notes[d.day.date]) d.changed = true;
    const sheet = sheets.find((s) => s.employeeId === employee.id);
    const status = sheet?.status ?? 'draft';
    const clientIds = [...new Set(summary.days.flatMap((d) => d.day.clientIds))];
    rows.push({
      employee,
      manager: employee.managerId ? (byId.get(employee.managerId) ?? null) : null,
      department: employee.departmentId ? (deptById.get(employee.departmentId) ?? null) : null,
      clients: clientIds.map((id) => ctx.clients[id]?.name ?? ''),
      status,
      totals: status === 'approved' && sheet?.totals ? (sheet.totals as MonthTotals) : summary.totals,
      summary,
      notes,
    });
  }

  return ok({
    year,
    month,
    closed: closures.length > 0,
    closedAt: closures[0]?.closedAt ?? null,
    rows,
    notApproved: rows.filter((r) => r.status !== 'approved'),
  });
}

export async function closeMonth(db: DB, actor: Actor, year: number, month: number): Promise<Result<void>> {
  if (!can(actor, 'months.close')) return fail('forbidden');
  const report = await monthReport(db, actor, year, month);
  if (!report.ok) return report;
  if (report.value.closed) return ok(undefined);
  if (report.value.notApproved.length) {
    return fail('not_all_approved', report.value.notApproved.map((r) => r.employee.nameEn).join(', '));
  }
  const [row] = await db.insert(monthClosures).values({ year, month, closedById: actor.id }).returning();
  await audit(db, { actorId: actor.id, action: 'close', entity: 'month', entityId: `${year}-${month}`, after: row });
  return ok(undefined);
}

/** Nudges everyone who hasn't submitted the month (draft or returned) through the bell, Slack and push. */
export async function remindUnsubmitted(db: DB, actor: Actor, year: number, month: number): Promise<Result<number>> {
  if (!can(actor, 'months.close')) return fail('forbidden');
  const report = await monthReport(db, actor, year, month);
  if (!report.ok) return report;
  const ids = report.value.notApproved.filter((r) => r.status === 'draft' || r.status === 'returned').map((r) => r.employee.id);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  await notify(db, ids, 'timesheet_reminder', { month: monthKey }, `/timesheet?month=${monthKey}`);
  await audit(db, { actorId: actor.id, action: 'remind', entity: 'month', entityId: monthKey, after: { employeeIds: ids } });
  return ok(ids.length);
}

/** Admin only: for corrections after payroll. Recorded in the audit log. */
export async function reopenMonth(db: DB, actor: Actor, year: number, month: number): Promise<Result<void>> {
  if (!can(actor, 'settings.manage')) return fail('forbidden');
  if (!(await isMonthClosed(db, year, month))) return ok(undefined);
  const [before] = await db
    .delete(monthClosures)
    .where(and(eq(monthClosures.year, year), eq(monthClosures.month, month)))
    .returning();
  await audit(db, { actorId: actor.id, action: 'reopen', entity: 'month', entityId: `${year}-${month}`, before });
  return ok(undefined);
}

/**
 * One client's part of a month: the people whose main client it was, and only the days it was. Hours can't be
 * split between two clients on one day yet, so a day belongs to the person's primary client and is never counted
 * in two clients' files. Totals are worked out from those days; each person's approval status is kept.
 */
export function clientMonthReport(report: MonthReport, clientId: string): MonthReport {
  const rows = report.rows.flatMap((r) => {
    const days = r.summary.days.filter((d) => d.day.primaryClientId === clientId);
    if (!days.length) return [];
    const totals = sumMonthDays(days);
    return [{ ...r, totals, summary: { ...r.summary, days, totals } }];
  });
  return { ...report, rows, notApproved: rows.filter((r) => r.status !== 'approved') };
}

/** The Finance export: a team summary, one sheet per person in the official EMS timesheet style, and flat data. */
export async function buildMonthWorkbook(report: MonthReport, attendance?: AttendanceMonth, title?: string): Promise<Buffer> {
  return buildTimesheetWorkbook(report, attendance, title);
}
