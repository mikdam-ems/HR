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
  returnMonth,
  submitMonth,
  type Actor,
} from '../timesheets';
import * as ts from '../timesheets';
import { resetDay, saveDay } from './approve';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, clock_events, day_change_requests, day_entries, timesheets, assignments, schedules, holidays, clients, calendars, settings, employees CASCADE`,
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
  // These tests cover schedule mode (every day pre-filled); clock mode has its own tests.
  await setSetting(db, 'hoursSource', []);
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

describe('day changes need the manager', () => {
  it('a change waits as a request, and lands on the timesheet only once approved', async () => {
    const { lina, khaled, omar } = await setup();
    const r = await ts.saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(10), note: 'Release' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toMatchObject({ applied: false });

    let m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.totals.regularOvertimeMinutes).toBe(0);
    expect(m.value.pending['2026-09-15']).toMatchObject({ action: 'set', workedMinutes: h(10) });

    // Only her manager sees and decides it.
    expect(await ts.listPendingDayChanges(db, khaled)).toHaveLength(1);
    expect(await ts.listPendingDayChanges(db, omar)).toHaveLength(0);
    expect(await ts.countPendingApprovals(db, khaled)).toBe(1);
    expect(await ts.decideDayChange(db, omar, r.value.requestId!, 'approve')).toMatchObject({ error: 'forbidden' });
    expect(await ts.decideDayChange(db, lina, r.value.requestId!, 'approve')).toMatchObject({ error: 'forbidden' });

    // Can't submit the month while a change is pending.
    expect(await submitMonth(db, lina, lina.id, 2026, 9, '2026-09-24')).toMatchObject({ error: 'pending_changes' });

    expect((await ts.decideDayChange(db, khaled, r.value.requestId!, 'approve')).ok).toBe(true);
    expect(await ts.decideDayChange(db, khaled, r.value.requestId!, 'approve')).toMatchObject({ error: 'already_decided' });
    m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.totals.regularOvertimeMinutes).toBe(h(2));
    expect(m.value.pending).toEqual({});
    expect((await submitMonth(db, lina, lina.id, 2026, 9, '2026-09-24')).ok).toBe(true);
  });

  it('a declined change leaves the timesheet as it was; editing again replaces the pending request', async () => {
    const { lina, khaled } = await setup();
    const first = await ts.saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(9) });
    const second = await ts.saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(11) });
    if (!first.ok || !second.ok) throw new Error('save');
    expect(second.value.requestId).toBe(first.value.requestId);
    expect(await ts.listPendingDayChanges(db, khaled)).toHaveLength(1);

    expect((await ts.decideDayChange(db, khaled, second.value.requestId!, 'decline', 'Not agreed')).ok).toBe(true);
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.days.find((d) => d.day.date === '2026-09-15')!.entry.workedMinutes).toBe(h(8));
  });

  it('saving the day back to how it stands withdraws the request; the person can also cancel it', async () => {
    const { lina, khaled } = await setup();
    await ts.saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(9) });
    await ts.saveDay(db, lina, lina.id, { date: '2026-09-15', startTime: '09:00', endTime: '17:00' });
    expect(await ts.listPendingDayChanges(db, khaled)).toHaveLength(0);

    const r = await ts.saveDay(db, lina, lina.id, { date: '2026-09-16', leaveType: 'sick' });
    if (!r.ok) throw new Error(r.error);
    expect(await ts.cancelDayChange(db, khaled, r.value.requestId!)).toMatchObject({ error: 'forbidden' });
    expect((await ts.cancelDayChange(db, lina, r.value.requestId!)).ok).toBe(true);
    expect(await ts.listPendingDayChanges(db, khaled)).toHaveLength(0);
  });

  it('asking to undo an approved change is a request too', async () => {
    const { lina, khaled } = await setup();
    await saveDay(db, lina, lina.id, { date: '2026-09-15', workedMinutes: h(10) });
    const r = await ts.resetDay(db, lina, lina.id, '2026-09-15');
    if (!r.ok) throw new Error(r.error);
    const [p] = await ts.listPendingDayChanges(db, khaled);
    expect(p).toMatchObject({ request: { action: 'reset' }, current: { workedMinutes: h(10) } });
    await ts.decideDayChange(db, khaled, r.value.requestId!, 'approve');
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.days.find((d) => d.day.date === '2026-09-15')!.changed).toBe(false);
  });

  it('the General Manager (no manager) changes their own days directly', async () => {
    const { boss } = await setup();
    const r = await ts.saveDay(db, boss, boss.id, { date: '2026-09-15', workedMinutes: h(10) });
    expect(r).toMatchObject({ ok: true, value: { applied: true } });
  });
});

describe('clock mode', () => {
  it('fills the month from clock in/out; past days with no clock are flagged, future days stay empty', async () => {
    const { lina } = await setup();
    await setSetting(db, 'hoursSource', [{ from: '2026-01-01', source: 'clock' }]);
    const { clock } = await import('../clock');
    const { ammanInstant } = await import('@/lib/format');
    await clock(db, lina.id, 'in', ammanInstant('2026-09-15', '09:00'));
    await clock(db, lina.id, 'out', ammanInstant('2026-09-15', '19:30'));

    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    const day = (d: string) => m.value.summary.days.find((x) => x.day.date === d)!;
    expect(day('2026-09-15').entry.workedMinutes).toBe(h(10.5));
    expect(day('2026-09-15').totals.regularOvertimeMinutes).toBe(h(10.5) - day('2026-09-15').day.expectedMinutes);
    // Before the first clock-in the schedule still applies; after it, a day with no clock is missing.
    expect(day('2026-09-14').entry.workedMinutes).toBe(day('2026-09-14').day.expectedMinutes);
    expect(day('2026-09-16').entry.workedMinutes).toBe(0);
    expect(day('2026-09-16').issues.map((i) => i.code)).toContain('missing_hours');
  });

  it('a forgotten clock-out counts nothing and is flagged, instead of running on until now', async () => {
    const { lina } = await setup();
    await setSetting(db, 'hoursSource', [{ from: '2026-01-01', source: 'clock' }]);
    const { clock } = await import('../clock');
    const { ammanInstant } = await import('@/lib/format');
    await clock(db, lina.id, 'in', ammanInstant('2026-09-10', '09:00'));

    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    const d = m.value.summary.days.find((x) => x.day.date === '2026-09-10')!;
    expect(d.entry.workedMinutes).toBe(0);
    expect(d.issues.map((i) => i.code)).toEqual(['clock_open']);
    expect(m.value.summary.totals.regularOvertimeMinutes).toBe(0);
  });

  it('a correction for a forgotten clock-in is a request, and once approved it counts', async () => {
    const { lina, khaled } = await setup();
    await setSetting(db, 'hoursSource', [{ from: '2026-01-01', source: 'clock' }]);
    const r = await ts.saveDay(db, lina, lina.id, { date: '2026-09-14', startTime: '09:00', endTime: '17:00', note: 'Forgot to clock in' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.requestId).not.toBeNull();
    await ts.decideDayChange(db, khaled, r.value.requestId!, 'approve');
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.days.find((x) => x.day.date === '2026-09-14')!.entry.workedMinutes).toBe(h(8));
  });
});

describe('switching where hours come from (issue #4)', () => {
  it('a switch changes only days from its date on', async () => {
    const { lina, boss: admin } = await setup();
    const { clock } = await import('../clock');
    const { ammanInstant } = await import('@/lib/format');
    const { setHoursSource } = await import('../settings');
    await clock(db, lina.id, 'in', ammanInstant('2026-09-14', '09:00'));
    await clock(db, lina.id, 'out', ammanInstant('2026-09-14', '20:00'));
    await clock(db, lina.id, 'in', ammanInstant('2026-09-21', '09:00'));
    await clock(db, lina.id, 'out', ammanInstant('2026-09-21', '20:00'));

    expect((await setHoursSource(db, admin.id, { from: '2026-09-20', source: 'clock' })).ok).toBe(true);
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    const day = (d: string) => m.value.summary.days.find((x) => x.day.date === d)!;
    expect(day('2026-09-14').entry.workedMinutes).toBe(h(8)); // the schedule, as before the switch
    expect(day('2026-09-21').entry.workedMinutes).toBe(h(11)); // the clock
  });

  it("can't start before the latest switch, or in or before a closed month", async () => {
    const { boss: admin } = await setup();
    const { setHoursSource } = await import('../settings');
    const { monthClosures } = await import('@/db/schema');
    await db.insert(monthClosures).values({ year: 2026, month: 8, closedById: admin.id });

    expect(await setHoursSource(db, admin.id, { from: '2026-08-20', source: 'clock' })).toMatchObject({ error: 'hours_source_date' });
    expect((await setHoursSource(db, admin.id, { from: '2026-09-15', source: 'clock' })).ok).toBe(true);
    expect(await setHoursSource(db, admin.id, { from: '2026-09-10', source: 'schedule' })).toMatchObject({ error: 'hours_source_date' });
    expect(await setHoursSource(db, admin.id, { from: 'not a date', source: 'schedule' })).toMatchObject({ error: 'invalid_input' });
  });
});

describe('who sees an attendance log', () => {
  it('the person, their manager, HR, Finance and admins; not a teammate', async () => {
    const { lina, omar, khaled, hr, boss } = await setup();
    const finance = { id: 'f', roles: ['finance'] } as ts.Actor;
    const linaRow = { id: lina.id, managerId: khaled.id };
    for (const who of [lina, khaled, hr, boss, finance]) expect(ts.canViewAttendance(who, linaRow)).toBe(true);
    expect(ts.canViewAttendance(omar, linaRow)).toBe(false);
  });
});

