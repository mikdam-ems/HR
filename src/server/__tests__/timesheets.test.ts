import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { createCalendar, createClient, setHoliday } from '../clients';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { setSetting } from '../settings';
import {
  approveMonth,
  getMonth,
  listPendingApprovals,
  resetDay,
  returnMonth,
  saveDay,
  submitMonth,
  type Actor,
} from '../timesheets';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, day_entries, timesheets, assignments, schedules, holidays, clients, calendars, settings, employees CASCADE`,
  );
});

const h = (n: number) => n * 60;

async function setup() {
  const sa = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
  const jo = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4] });
  if (!sa.ok || !jo.ok) throw new Error('calendar');
  await setHoliday(db, null, { calendarId: sa.value, date: '2026-09-23', nameEn: 'Saudi National Day' });
  await setHoliday(db, null, { calendarId: jo.value, date: '2026-08-26', nameEn: "Prophet's Birthday (test)" });
  await setSetting(db, 'homeCalendarId', jo.value);
  const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: sa.value });
  if (!jadwa.ok) throw new Error('client');

  const make = async (email: string, managerId: string | null = null, roles: ('hr' | 'admin')[] = []) => {
    const r = await createEmployee(db, null, { email, nameEn: email, managerId, roles });
    if (!r.ok) throw new Error(r.error);
    await addAssignment(db, null, { employeeId: r.value.id, clientId: jadwa.value, startDate: '2026-01-01' });
    await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' });
    return r.value;
  };
  const boss = await make('boss@x.com', null, ['admin']);
  const khaled = await make('khaled@x.com', boss.id);
  const lina = await make('lina@x.com', khaled.id);
  const omar = await make('omar@x.com', khaled.id);
  const hr = await make('hr@x.com', boss.id, ['hr']);
  const as = (e: { id: string; roles: Actor['roles'] }): Actor => ({ id: e.id, roles: e.roles });
  return { boss: as(boss), khaled: as(khaled), lina: as(lina), omar: as(omar), hr: as(hr) };
}

describe('a month', () => {
  it('starts fully filled in from the schedule and calendars', async () => {
    const { lina } = await setup();
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.status).toBe('draft');
    expect(m.value.summary.totals.workingDays).toBe(21);
    expect(m.value.summary.totals.workedMinutes).toBe(h(168));
    expect(m.value.summary.days.some((d) => d.changed)).toBe(false);
  });

  it('records the wireframe September: overtime, sick day, annual leave', async () => {
    const { lina } = await setup();
    expect((await saveDay(db, lina, lina.id, { date: '2026-09-15', startTime: '09:00', endTime: '19:00', note: 'Release support' })).ok).toBe(true);
    await saveDay(db, lina, lina.id, { date: '2026-09-08', leaveType: 'sick' });
    await saveDay(db, lina, lina.id, { date: '2026-09-16', leaveType: 'annual' });
    await saveDay(db, lina, lina.id, { date: '2026-09-17', leaveType: 'annual' });
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    const t = m.value.summary.totals;
    expect(t.workedMinutes).toBe(h(146));
    expect(t.regularOvertimeMinutes).toBe(h(2));
    expect(t.leaveDaysByType).toEqual({ sick: 1, annual: 2 });
    expect(m.value.notes['2026-09-15']).toBe('Release support');
    expect(m.value.times['2026-09-15']).toEqual({ start: '09:00', end: '19:00' });
    expect(m.value.summary.days.filter((d) => d.changed)).toHaveLength(4);
  });

  it('a full day of leave counts no hours, even if the time fields were left filled in', async () => {
    const { lina } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-08', leaveType: 'sick', startTime: '09:00', endTime: '17:00' });
    await saveDay(db, lina, lina.id, { date: '2026-09-09', leaveType: 'annual', leavePortion: 0.5, startTime: '09:00', endTime: '13:00' });
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    const day = (date: string) => m.value.summary.days.find((d) => d.day.date === date)!;
    expect(day('2026-09-08').entry.workedMinutes).toBe(0);
    expect(day('2026-09-09').entry.workedMinutes).toBe(h(4));
    expect(m.value.summary.totals.regularOvertimeMinutes).toBe(0);
    expect(m.value.summary.issues).toEqual([]);
  });

  it('saving a day back to its schedule removes the change', async () => {
    const { lina } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(10) });
    await saveDay(db, lina, lina.id, { date: '2026-09-15', startTime: '09:00', endTime: '17:00' });
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.days.some((d) => d.changed)).toBe(false);
  });

  it('a note alone marks the day for the manager', async () => {
    const { lina } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-14', note: 'Worked from the client office' });
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.days.find((d) => d.day.date === '2026-09-14')?.changed).toBe(true);
  });

  it('counts a worked Jordanian holiday as special overtime automatically', async () => {
    const { omar } = await setup();
    const m = await getMonth(db, omar, omar.id, 2026, 8);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.totals.specialOvertimeMinutes).toBe(h(8));
    expect(m.value.summary.totals.weightedOvertimeMinutes).toBe(h(9.6));
  });

  it('handles work on a client holiday as off-day overtime', async () => {
    const { lina } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-23', startTime: '10:00', endTime: '13:00', note: 'Incident' });
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.totals.offDayOvertimeMinutes).toBe(h(3));
  });
});

describe('who can do what', () => {
  it('only the person edits their own timesheet', async () => {
    const { lina, khaled, hr } = await setup();
    expect(await saveDay(db, khaled, lina.id, { date: '2026-09-15', workedMinutes: h(9) })).toMatchObject({ error: 'forbidden' });
    expect(await saveDay(db, hr, lina.id, { date: '2026-09-15', workedMinutes: h(9) })).toMatchObject({ error: 'forbidden' });
    expect(await resetDay(db, khaled, lina.id, '2026-09-15')).toMatchObject({ error: 'forbidden' });
  });

  it('colleagues cannot see each other; managers and HR can', async () => {
    const { lina, omar, khaled, hr } = await setup();
    expect(await getMonth(db, omar, lina.id, 2026, 9)).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await getMonth(db, khaled, lina.id, 2026, 9)).ok).toBe(true);
    expect((await getMonth(db, hr, lina.id, 2026, 9)).ok).toBe(true);
  });

  it('cannot submit a month that has not started', async () => {
    const { lina } = await setup();
    expect(await submitMonth(db, lina, lina.id, 2026, 10, '2026-09-24')).toMatchObject({ error: 'month_not_started' });
  });
});

describe('submit → approve / return', () => {
  it('runs the whole flow and locks editing after submit', async () => {
    const { lina, khaled, omar } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(10) });
    expect((await submitMonth(db, lina, lina.id, 2026, 9, '2026-09-24')).ok).toBe(true);

    // Submitted: no more edits, shows up for the manager only.
    expect(await saveDay(db, lina, lina.id, { date: '2026-09-16', workedMinutes: h(9) })).toMatchObject({ error: 'forbidden' });
    const pending = await listPendingApprovals(db, khaled);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.changedDays).toBe(1);
    expect(await listPendingApprovals(db, omar)).toHaveLength(0);

    // Colleague can't decide; returning needs a note.
    const id = pending[0]!.timesheet.id;
    expect(await approveMonth(db, omar, id)).toMatchObject({ error: 'forbidden' });
    expect(await returnMonth(db, khaled, id, null)).toMatchObject({ error: 'invalid_input' });

    // Return → editable again → resubmit → approve.
    expect((await returnMonth(db, khaled, id, 'Please add a note for the 15th')).ok).toBe(true);
    const returned = await getMonth(db, lina, lina.id, 2026, 9);
    if (!returned.ok) throw new Error(returned.error);
    expect(returned.value.status).toBe('returned');
    expect(returned.value.timesheet?.managerNote).toBe('Please add a note for the 15th');
    expect((await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(10), note: 'Release' })).ok).toBe(true);
    expect((await submitMonth(db, lina, lina.id, 2026, 9, '2026-09-24')).ok).toBe(true);
    expect((await approveMonth(db, khaled, id)).ok).toBe(true);
    expect(await approveMonth(db, khaled, id)).toMatchObject({ error: 'already_decided' });

    const approved = await getMonth(db, lina, lina.id, 2026, 9);
    if (!approved.ok) throw new Error(approved.error);
    expect(approved.value.status).toBe('approved');
    expect(approved.value.access.edit).toBe(false);
    expect((approved.value.timesheet?.totals as { regularOvertimeMinutes: number }).regularOvertimeMinutes).toBe(h(2));
  });

  it('nobody approves their own timesheet; an admin covers people with no manager', async () => {
    const { boss } = await setup();
    await submitMonth(db, boss, boss.id, 2026, 9, '2026-09-24');
    expect(await listPendingApprovals(db, boss)).toHaveLength(0);
  });
});
