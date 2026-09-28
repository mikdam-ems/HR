import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { ammanInstant } from '@/lib/format';
import { monthAttendanceReport } from '../attendance';
import { clock } from '../clock';
import { createCalendar, createClient, setHoliday } from '../clients';
import { createRequest, decideRequest } from '../leave';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { buildMonthWorkbook, clientMonthReport, closeMonth, monthReport, remindUnsubmitted, reopenMonth } from '../reports';
import { listNotifications } from '../notify';
import { setSetting } from '../settings';
import { approveMonth, getMonth, listPendingApprovals, returnMonth, submitMonth, type Actor } from '../timesheets';
import { saveDay } from './approve';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, clock_events, month_closures, leave_requests, leave_adjustments, day_entries, timesheets, assignments, schedules, holidays, clients, calendars, settings, employees CASCADE`,
  );
});

async function setup() {
  const sa = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
  const jo = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4] });
  if (!sa.ok || !jo.ok) throw new Error('calendar');
  await setHoliday(db, null, { calendarId: sa.value, date: '2026-09-23', nameEn: 'Saudi National Day' });
  await setSetting(db, 'homeCalendarId', jo.value);
  // These tests cover schedule mode (every day pre-filled); clock mode has its own tests.
  await setSetting(db, 'hoursSource', 'schedule');
  const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: sa.value });
  if (!jadwa.ok) throw new Error('client');
  const make = async (email: string, managerId: string | null, roles: ('hr' | 'admin' | 'finance')[] = [], assign = true) => {
    const r = await createEmployee(db, null, { email, nameEn: email.split('@')[0]!, managerId, roles, hireDate: '2022-01-01' });
    if (!r.ok) throw new Error(r.error);
    if (assign) {
      await addAssignment(db, null, { employeeId: r.value.id, clientId: jadwa.value, startDate: '2026-01-01' });
      await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' });
    }
    return { id: r.value.id, roles: r.value.roles } as Actor;
  };
  const admin = await make('admin@x.com', null, ['admin'], false);
  const khaled = await make('khaled@x.com', admin.id);
  const lina = await make('lina@x.com', khaled.id);
  const hr = await make('hr@x.com', admin.id, ['hr'], false);
  const finance = await make('finance@x.com', admin.id, ['finance'], false);
  return { admin, khaled, lina, hr, finance, jadwaId: jadwa.value, calendarId: sa.value };
}

async function approveAll(people: { khaled: Actor; lina: Actor; admin: Actor }) {
  await submitMonth(db, people.lina, people.lina.id, 2026, 9, '2026-09-30');
  await submitMonth(db, people.khaled, people.khaled.id, 2026, 9, '2026-09-30');
  for (const p of await listPendingApprovals(db, people.khaled)) await approveMonth(db, people.khaled, p.timesheet.id);
  for (const p of await listPendingApprovals(db, people.admin)) await approveMonth(db, people.admin, p.timesheet.id);
}

describe('month report', () => {
  it('lists everyone with a client that month, for HR and Finance only', async () => {
    const { lina, finance, hr } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: 600 });
    expect(await monthReport(db, lina, 2026, 9)).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await monthReport(db, hr, 2026, 9)).ok).toBe(true);
    const r = await monthReport(db, finance, 2026, 9);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.rows.map((x) => x.employee.email)).toEqual(['khaled@x.com', 'lina@x.com']); // no-client staff left out
    const linaRow = r.value.rows.find((x) => x.employee.email === 'lina@x.com')!;
    expect(linaRow.totals.regularOvertimeMinutes).toBe(120);
    expect(linaRow.status).toBe('draft');
  });

  it('exports an Excel file Finance can read', async () => {
    const { lina, hr } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: 600, note: 'Release' });
    await saveDay(db, lina, lina.id, { date: '2026-09-16', leaveType: 'annual' });
    const r = await monthReport(db, hr, 2026, 9);
    if (!r.ok) throw new Error(r.error);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildMonthWorkbook(r.value)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'khaled', 'lina', 'Data']);

    // Summary: a row per person, the name linking to their sheet.
    const summary = wb.getWorksheet('Summary')!;
    const header = (summary.getRow(7).values as unknown[]).slice(1);
    const linaRow = summary.getRow(9).values as unknown[];
    const col = (name: string) => linaRow[header.indexOf(name) + 1];
    expect(col('Employee')).toMatchObject({ text: 'lina', hyperlink: "#'lina'!A1" });
    expect(col('Working days')).toBe(21);
    expect(col('OT hrs')).toBe(2);
    expect(col('PL hrs')).toBe(8);
    expect(col('Client hrs')).toBe(20 * 8);

    // The person's sheet: details, and one row per day with a Total Hrs row.
    const sheet = wb.getWorksheet('lina')!;
    expect(sheet.getCell('C7').value).toBe('lina');
    const rows: unknown[][] = [];
    sheet.eachRow((row) => rows.push(row.values as unknown[]));
    const total = rows.find((r) => r[2] === 'Total Hrs')!;
    expect(total[3]).toMatchObject({ formula: expect.stringMatching(/^SUM\(C\d+:C\d+\)$/), result: 160 });
    const sept15 = rows.find((r) => r[2] instanceof Date && (r[2] as Date).toISOString().startsWith('2026-09-15'))!;
    expect(sept15[7]).toBe(2); // OT
    expect(sept15[10]).toBe('Release');
    expect(wb.getWorksheet('Data')!.rowCount).toBe(1 + 2 * 30);
  });

  it('adds an Attendance sheet from the clock, after the Summary', async () => {
    const { lina, hr } = await setup();
    await clock(db, lina.id, 'in', ammanInstant('2026-09-14', '09:30'), 'web', 'client_site');
    await clock(db, lina.id, 'out', ammanInstant('2026-09-14', '17:30'));
    const r = await monthReport(db, hr, 2026, 9);
    const a = await monthAttendanceReport(db, hr, 2026, 9, ammanInstant('2026-09-16', '12:00'));
    if (!r.ok || !a.ok) throw new Error('report');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildMonthWorkbook(r.value, a.value)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Attendance', 'khaled', 'lina', 'Data']);
    const sheet = wb.getWorksheet('Attendance')!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    const row = (name: string) => {
      let found: unknown[] = [];
      sheet.eachRow((x) => {
        if ((x.values as unknown[])[1] === name) found = x.values as unknown[];
      });
      return (col: string) => found[header.indexOf(col) + 1];
    };
    const linaRow = row('lina');
    expect(linaRow('Days in')).toBe(1);
    expect(linaRow('Late days')).toBe(1);
    expect(linaRow('Late hrs')).toBe(0.5);
    expect(linaRow('Absent days')).toBe(1); // the 15th: no clock-in
    expect(linaRow('Client-site days')).toBe(1);
    expect(row('khaled')('Note')).toBe('Not using the clock yet');

    // The Data sheet says where each clocked day was worked (#18); other days stay empty.
    const data = wb.getWorksheet('Data')!;
    const dataHead = (data.getRow(1).values as unknown[]).slice(1);
    const where = (name: string, date: string) => {
      let value: unknown = null;
      data.eachRow((x) => {
        const v = x.values as unknown[];
        if (v[1] === name && v[2] === date) value = v[dataHead.indexOf('Where') + 1] ?? '';
      });
      return value;
    };
    expect(where('lina', '2026-09-14')).toBe('Client site');
    expect(where('lina', '2026-09-15')).toBe('');
  });
});

describe('client hours export', () => {
  it('has only the people whose main client it was, and only those days, with totals for those days', async () => {
    const { hr, lina, jadwaId, calendarId } = await setup();
    // Nour moves from Jadwa to Hala on 16 September.
    const hala = await createClient(db, null, { nameEn: 'Hala', calendarId });
    if (!hala.ok) throw new Error('client');
    const nour = await createEmployee(db, null, { email: 'nour@x.com', nameEn: 'nour', hireDate: '2022-01-01' });
    if (!nour.ok) throw new Error(nour.error);
    await addAssignment(db, null, { employeeId: nour.value.id, clientId: jadwaId, startDate: '2026-01-01', endDate: '2026-09-15' });
    await addAssignment(db, null, { employeeId: nour.value.id, clientId: hala.value, startDate: '2026-09-16' });
    await setSchedule(db, null, { employeeId: nour.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' });
    await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: 600 });

    const r = await monthReport(db, hr, 2026, 9);
    if (!r.ok) throw new Error(r.error);
    const atHala = clientMonthReport(r.value, hala.value);
    expect(atHala.rows.map((x) => x.employee.nameEn)).toEqual(['nour']);
    const nourAtHala = atHala.rows[0]!;
    expect(nourAtHala.summary.days[0]!.day.date).toBe('2026-09-16');
    expect(nourAtHala.totals.workingDays).toBe(10); // 16–30 Sept, Sun–Thu, less Saudi National Day (23rd)
    expect(nourAtHala.status).toBe('draft');

    const atJadwa = clientMonthReport(r.value, jadwaId);
    expect(atJadwa.rows.map((x) => x.employee.nameEn)).toEqual(['khaled', 'lina', 'nour']);
    const nourAtJadwa = atJadwa.rows.find((x) => x.employee.nameEn === 'nour')!;
    // Every Jadwa day plus every Hala day is the whole month, never more.
    expect(nourAtJadwa.totals.workingDays + nourAtHala.totals.workingDays).toBe(
      r.value.rows.find((x) => x.employee.nameEn === 'nour')!.totals.workingDays,
    );
    expect(atJadwa.rows.find((x) => x.employee.nameEn === 'lina')!.totals.regularOvertimeMinutes).toBe(120);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildMonthWorkbook(atHala, undefined, 'Hala · Hours')) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'nour', 'Data']);
    expect(wb.getWorksheet('Summary')!.getCell('D2').value).toBe('Hala · Hours');
    expect(wb.getWorksheet('Data')!.rowCount).toBe(1 + 15);
  });
});

describe('month report in clock mode', () => {
  it('a forgotten clock-out adds no overtime to the report', async () => {
    const { lina, finance } = await setup();
    await setSetting(db, 'hoursSource', 'clock');
    const { clock } = await import('../clock');
    const { ammanInstant } = await import('@/lib/format');
    await clock(db, lina.id, 'in', ammanInstant('2026-09-08', '09:00'));
    await clock(db, lina.id, 'out', ammanInstant('2026-09-08', '19:00'));
    await clock(db, lina.id, 'in', ammanInstant('2026-09-10', '09:00'));

    const r = await monthReport(db, finance, 2026, 9);
    if (!r.ok) throw new Error(r.error);
    const row = r.value.rows.find((x) => x.employee.id === lina.id)!;
    // Only the 8th's two extra hours; the open session on the 10th counts nothing.
    expect(row.summary.totals.regularOvertimeMinutes).toBe(120);
    expect(row.summary.issues.some((i) => i.date === '2026-09-10' && i.code === 'clock_open')).toBe(true);
  });
});

describe('closing a month', () => {
  it('needs every timesheet approved, then freezes timesheets and leave', async () => {
    const { admin, khaled, lina, hr, finance } = await setup();
    expect(await closeMonth(db, finance, 2026, 9)).toMatchObject({ ok: false, error: 'forbidden' });
    const blocked = await closeMonth(db, hr, 2026, 9);
    expect(blocked).toMatchObject({ ok: false, error: 'not_all_approved' });
    expect(blocked.ok ? '' : blocked.detail).toContain('lina');

    await approveAll({ khaled, lina, admin });
    expect((await closeMonth(db, hr, 2026, 9)).ok).toBe(true);

    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.closed).toBe(true);
    // The manager can't return it, and new leave can't land in it.
    const sheetId = m.value.timesheet!.id;
    expect(await returnMonth(db, khaled, sheetId, 'change')).toMatchObject({ ok: false });
    const leave = await createRequest(db, lina, { type: 'sick', fromDate: '2026-09-28', toDate: '2026-09-28' });
    if (!leave.ok) throw new Error(leave.error);
    expect(await decideRequest(db, khaled, leave.value, 'approve', null)).toMatchObject({ error: 'month_locked' });
  });

  it('only an admin reopens a closed month', async () => {
    const { admin, khaled, lina, hr } = await setup();
    await approveAll({ khaled, lina, admin });
    await closeMonth(db, hr, 2026, 9);
    expect(await reopenMonth(db, hr, 2026, 9)).toMatchObject({ error: 'forbidden' });
    expect((await reopenMonth(db, admin, 2026, 9)).ok).toBe(true);
    const r = await monthReport(db, hr, 2026, 9);
    expect(r.ok && r.value.closed).toBe(false);
  });
});

describe('reminding people to submit', () => {
  it('notifies only those who have not submitted, and only HR/admin may send it', async () => {
    const { lina, hr } = await setup();
    expect(await remindUnsubmitted(db, lina, 2026, 9)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await remindUnsubmitted(db, hr, 2026, 9)).toEqual({ ok: true, value: 2 });
    expect((await listNotifications(db, lina.id))[0]).toMatchObject({ kind: 'timesheet_reminder', link: '/timesheet?month=2026-09' });
  });
});
