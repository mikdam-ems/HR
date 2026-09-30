import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { ammanInstant } from '@/lib/format';
import { monthAttendanceReport } from '../attendance';
import { createCalendar, createClient } from '../clients';
import { clock, clockOutAt } from '../clock';
import { createRequest, decideRequest } from '../leave';
import { addAssignment, createEmployee, setSchedule } from '../people';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, clock_events, leave_requests, day_entries, assignments, schedules, clients, calendars, settings, employees CASCADE`,
  );
});

const t = (local: string) => ammanInstant(local.slice(0, 10), local.slice(11, 16));

describe('monthAttendanceReport', () => {
  it('counts late days, absences, forgotten clock-outs and places, from the first clock-in on', async () => {
    const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
    if (!cal.ok) throw new Error('calendar');
    const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
    if (!jadwa.ok) throw new Error('client');
    const boss = await createEmployee(db, null, { email: 'boss@ems.com', nameEn: 'Boss', roles: ['hr'] });
    if (!boss.ok) throw new Error(boss.error);
    const make = async (name: string) => {
      const r = await createEmployee(db, null, { email: `${name}@ems.com`, nameEn: name, managerId: boss.value.id, hireDate: '2022-01-01' });
      if (!r.ok) throw new Error(r.error);
      await addAssignment(db, null, { employeeId: r.value.id, clientId: jadwa.value, startDate: '2026-01-01' });
      await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
      return r.value;
    };
    const maya = await make('maya');
    const lina = await make('lina'); // never clocks in

    // Sunday 20 September 2026 onwards; Friday and Saturday are the weekend.
    await clock(db, maya.id, 'in', t('2026-09-20 09:00'), 'web', 'office');
    await clock(db, maya.id, 'out', t('2026-09-20 17:30'));
    await clock(db, maya.id, 'in', t('2026-09-21 09:40'), 'web', 'client_site'); // late, forgot to clock out
    await clockOutAt(db, maya.id, '2026-09-21', '17:30', t('2026-09-22 08:00'));
    // 22nd: nothing → absent.
    const leave = await createRequest(db, { id: maya.id, roles: maya.roles }, { type: 'annual', fromDate: '2026-09-23', toDate: '2026-09-23' });
    if (!leave.ok) throw new Error(leave.error);
    await decideRequest(db, { id: boss.value.id, roles: boss.value.roles }, leave.value, 'approve', null);
    await clock(db, maya.id, 'in', t('2026-09-24 09:20'), 'slack', 'remote'); // late, still open
    await clock(db, maya.id, 'in', t('2026-09-27 09:00'), 'web'); // refused: the 24th is still open

    const result = await monthAttendanceReport(db, boss.value, 2026, 9, t('2026-09-27 10:00'));
    if (!result.ok) throw new Error(result.error);
    const row = result.value.rows.find((r) => r.employee.id === maya.id)!;
    expect(row.days.map((d) => `${d.date.slice(8)}:${d.presence.status}`)).toEqual([
      '20:done',
      '21:done',
      '22:absent',
      '23:on_leave',
      '24:done',
      '25:off',
      '26:off',
    ]);
    expect(row.totals).toEqual({
      daysIn: 3,
      lateDays: 2,
      lateMinutes: 60,
      absentDays: 1,
      forgotOut: 2,
      places: { office: 1, client_site: 1, remote: 1 },
    });

    // Where each clocked day was worked, for the export: finished days and today alike.
    expect(row.places).toEqual({ '2026-09-20': 'office', '2026-09-21': 'client_site', '2026-09-24': 'remote' });
    await clockOutAt(db, maya.id, '2026-09-24', '17:30', t('2026-09-27 09:00'));
    await clock(db, maya.id, 'in', t('2026-09-27 09:05'), 'web', 'office');
    const later = await monthAttendanceReport(db, boss.value, 2026, 9, t('2026-09-27 10:00'));
    if (!later.ok) throw new Error(later.error);
    expect(later.value.rows.find((r) => r.employee.id === maya.id)!.places['2026-09-27']).toBe('office');

    const never = result.value.rows.find((r) => r.employee.id === lina.id)!;
    expect(never).toMatchObject({ onClock: false, days: [], totals: { absentDays: 0 } });
  });

  it('files a night shift under the day it began, where it began', async () => {
    const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
    if (!cal.ok) throw new Error('calendar');
    const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
    if (!jadwa.ok) throw new Error('client');
    const boss = await createEmployee(db, null, { email: 'boss@ems.com', nameEn: 'Boss', roles: ['hr'] });
    const nora = await createEmployee(db, null, { email: 'nora@ems.com', nameEn: 'Nora', hireDate: '2022-01-01' });
    if (!boss.ok || !nora.ok) throw new Error('employee');
    await addAssignment(db, null, { employeeId: nora.value.id, clientId: jadwa.value, startDate: '2026-01-01' });
    await setSchedule(db, null, { employeeId: nora.value.id, effectiveFrom: '2026-01-01', startTime: '22:00', endTime: '06:00' });

    await clock(db, nora.value.id, 'in', t('2026-09-20 22:00'), 'web', 'client_site');
    await clock(db, nora.value.id, 'out', t('2026-09-21 06:00'));

    const result = await monthAttendanceReport(db, boss.value, 2026, 9, t('2026-09-22 10:00'));
    if (!result.ok) throw new Error(result.error);
    const row = result.value.rows.find((r) => r.employee.id === nora.value.id)!;
    expect(row.places).toEqual({ '2026-09-20': 'client_site' });
    expect(row.days.find((d) => d.date === '2026-09-20')!.forgotOut).toBe(false);
    // The clock-out after midnight doesn't make the 21st a clocked day of its own.
    expect(row.days.find((d) => d.date === '2026-09-21')!.firstIn).toBeNull();
    expect(row.totals.forgotOut).toBe(0);
  });

  it('is for HR, Finance and admins only', async () => {
    expect(await monthAttendanceReport(db, { roles: ['employee'] }, 2026, 9)).toMatchObject({ ok: false, error: 'forbidden' });
  });
});
