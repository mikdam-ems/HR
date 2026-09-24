import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { createCalendar, createClient, setHoliday } from '../clients';
import { createRequest, decideRequest } from '../leave';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { buildMonthWorkbook, closeMonth, monthReport, reopenMonth } from '../reports';
import { setSetting } from '../settings';
import { approveMonth, getMonth, listPendingApprovals, returnMonth, saveDay, submitMonth, type Actor } from '../timesheets';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, month_closures, leave_requests, leave_adjustments, day_entries, timesheets, assignments, schedules, holidays, clients, calendars, settings, employees CASCADE`,
  );
});

async function setup() {
  const sa = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
  const jo = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4] });
  if (!sa.ok || !jo.ok) throw new Error('calendar');
  await setHoliday(db, null, { calendarId: sa.value, date: '2026-09-23', nameEn: 'Saudi National Day' });
  await setSetting(db, 'homeCalendarId', jo.value);
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
  return { admin, khaled, lina, hr, finance };
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
    const summary = wb.getWorksheet('Summary 2026-09')!;
    const header = (summary.getRow(1).values as unknown[]).slice(1);
    const linaRow = summary.getRow(3).values as unknown[];
    const col = (name: string) => linaRow[header.indexOf(name) + 1];
    expect(col('Employee')).toBe('lina');
    expect(col('Working days')).toBe(21);
    expect(col('Hours worked')).toBe(162);
    expect(col('Regular OT hours')).toBe(2);
    expect(col('Annual leave days')).toBe(1);
    const days = wb.getWorksheet('Days 2026-09')!;
    expect(days.rowCount).toBe(1 + 2 * 30);
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
