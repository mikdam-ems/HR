import ExcelJS from 'exceljs';
import { and, between, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { dayEntries, employees, monthClosures, timesheets, type Employee, type TimesheetRow } from '@/db/schema';
import { type DayEntry, type MonthSummary, type MonthTotals, daysOfMonth, summarizeMonth } from '@/domain';
import { audit } from './audit';
import { can, type CurrentUser } from './permissions';
import { loadRulesContext } from './rulesContext';
import { getSettings } from './settings';
import { isMonthClosed } from './timesheets';
import { type Result, fail, ok } from './validation';

export interface ReportRow {
  employee: Employee;
  manager: Employee | null;
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
  const [ctx, appSettings, people, entries, sheets, closures] = await Promise.all([
    loadRulesContext(db),
    getSettings(db),
    db.select().from(employees),
    db.select().from(dayEntries).where(between(dayEntries.date, days[0]!, days[days.length - 1]!)),
    db.select().from(timesheets).where(and(eq(timesheets.year, year), eq(timesheets.month, month))),
    db.select().from(monthClosures).where(and(eq(monthClosures.year, year), eq(monthClosures.month, month))),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));

  const rows: ReportRow[] = [];
  for (const employee of people.filter((p) => p.active).sort((a, b) => a.nameEn.localeCompare(b.nameEn))) {
    const mine = entries.filter((e) => e.employeeId === employee.id);
    const dayEntryList: DayEntry[] = mine.map((r) => ({
      date: r.date,
      workedMinutes: r.workedMinutes,
      ...(r.leaveType ? { leave: { type: r.leaveType, portion: r.leavePortion === 0.5 ? 0.5 : 1 } } : {}),
    }));
    const summary = summarizeMonth(ctx, employee.id, year, month, dayEntryList, appSettings.overtimeRates);
    if (summary.days.every((d) => d.day.dayType === 'unassigned')) continue; // not working for anyone this month
    const notes = Object.fromEntries(mine.filter((r) => r.note).map((r) => [r.date, r.note!]));
    for (const d of summary.days) if (notes[d.day.date]) d.changed = true;
    const sheet = sheets.find((s) => s.employeeId === employee.id);
    const status = sheet?.status ?? 'draft';
    const clientIds = [...new Set(summary.days.flatMap((d) => d.day.clientIds))];
    rows.push({
      employee,
      manager: employee.managerId ? (byId.get(employee.managerId) ?? null) : null,
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

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** The Finance export: a summary row per person, and every day for anyone who wants to check. */
export async function buildMonthWorkbook(report: MonthReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EMS People & Culture';
  const label = `${report.year}-${String(report.month).padStart(2, '0')}`;

  const summary = wb.addWorksheet(`Summary ${label}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  summary.columns = [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Job title', key: 'title', width: 20 },
    { header: 'Manager', key: 'manager', width: 20 },
    { header: 'Client', key: 'client', width: 22 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Working days', key: 'workingDays', width: 13 },
    { header: 'Expected hours', key: 'expected', width: 15 },
    { header: 'Hours worked', key: 'worked', width: 14 },
    { header: 'Regular OT hours', key: 'regular', width: 17 },
    { header: 'Special OT hours (Jordan holiday)', key: 'special', width: 20 },
    { header: 'Off-day OT hours', key: 'offDay', width: 16 },
    { header: 'Weighted OT hours', key: 'weighted', width: 18 },
    { header: 'Annual leave days', key: 'annual', width: 16 },
    { header: 'Sick leave days', key: 'sick', width: 14 },
    { header: 'Unpaid leave days', key: 'unpaid', width: 16 },
    { header: 'Other leave days', key: 'other', width: 15 },
  ];
  for (const r of report.rows) {
    const t = r.totals;
    const leave = t.leaveDaysByType;
    const other = Object.entries(leave)
      .filter(([k]) => !['annual', 'sick', 'unpaid'].includes(k))
      .reduce((s, [, v]) => s + (v ?? 0), 0);
    summary.addRow({
      name: r.employee.nameEn,
      email: r.employee.email,
      title: r.employee.jobTitle ?? '',
      manager: r.manager?.nameEn ?? '',
      client: r.clients.join(', '),
      status: r.status,
      workingDays: t.workingDays,
      expected: hours(t.expectedMinutes),
      worked: hours(t.workedMinutes),
      regular: hours(t.regularOvertimeMinutes),
      special: hours(t.specialOvertimeMinutes),
      offDay: hours(t.offDayOvertimeMinutes),
      weighted: hours(t.weightedOvertimeMinutes),
      annual: leave.annual ?? 0,
      sick: leave.sick ?? 0,
      unpaid: leave.unpaid ?? 0,
      other,
    });
  }
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).alignment = { wrapText: true, vertical: 'top' };

  const daySheet = wb.addWorksheet(`Days ${label}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  daySheet.columns = [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Day type', key: 'type', width: 18 },
    { header: 'Holiday', key: 'holiday', width: 22 },
    { header: 'Expected hours', key: 'expected', width: 15 },
    { header: 'Hours worked', key: 'worked', width: 14 },
    { header: 'Regular OT', key: 'regular', width: 11 },
    { header: 'Special OT', key: 'special', width: 11 },
    { header: 'Off-day OT', key: 'offDay', width: 11 },
    { header: 'Leave type', key: 'leave', width: 12 },
    { header: 'Leave days', key: 'leaveDays', width: 11 },
    { header: 'Changed', key: 'changed', width: 9 },
    { header: 'Note', key: 'note', width: 40 },
  ];
  for (const r of report.rows) {
    for (const d of r.summary.days) {
      daySheet.addRow({
        name: r.employee.nameEn,
        date: d.day.date,
        type: d.day.dayType,
        holiday: d.day.holidayName ?? '',
        expected: hours(d.day.expectedMinutes),
        worked: hours(d.entry.workedMinutes),
        regular: hours(d.totals.regularOvertimeMinutes),
        special: hours(d.totals.specialOvertimeMinutes),
        offDay: hours(d.totals.offDayOvertimeMinutes),
        leave: d.entry.leave?.type ?? '',
        leaveDays: d.totals.leaveDays || '',
        changed: d.changed ? 'yes' : '',
        note: r.notes[d.day.date] ?? '',
      });
    }
  }
  daySheet.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
