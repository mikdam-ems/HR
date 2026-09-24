import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { createCalendar, createClient, setHoliday } from '../clients';
import {
  addAdjustment,
  cancelRequest,
  createRequest,
  decideRequest,
  getBalances,
  listPendingLeave,
  previewRequest,
  teamOff,
} from '../leave';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { setSetting } from '../settings';
import { getMonth, submitMonth, type Actor } from '../timesheets';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, leave_requests, leave_adjustments, day_entries, timesheets, assignments, schedules, holidays, clients, calendars, settings, employees CASCADE`,
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
  const make = async (email: string, managerId: string | null, hireDate: string, roles: ('hr' | 'admin')[] = []) => {
    const r = await createEmployee(db, null, { email, nameEn: email, managerId, hireDate, roles });
    if (!r.ok) throw new Error(r.error);
    await addAssignment(db, null, { employeeId: r.value.id, clientId: jadwa.value, startDate: '2020-01-01' });
    await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2020-01-01', startTime: '09:00', endTime: '17:00' });
    return { id: r.value.id, roles: r.value.roles } as Actor;
  };
  const khaled = await make('khaled@x.com', null, '2015-01-01', ['admin']);
  const lina = await make('lina@x.com', khaled.id, '2024-03-01');
  const sami = await make('sami@x.com', khaled.id, '2019-06-01');
  const omar = await make('omar@x.com', khaled.id, '2023-01-01');
  return { khaled, lina, sami, omar };
}

const annual = async (id: string, year = 2026) => (await getBalances(db, id, year)).find((b) => b.type === 'annual')!;

describe('balances', () => {
  it('annual is 14 days, 21 once 5 years are completed by 1 January', async () => {
    const { lina, sami } = await setup();
    expect((await annual(lina.id)).entitlement).toBe(14);
    expect((await annual(sami.id)).entitlement).toBe(21); // hired June 2019 → 6 years on 1 Jan 2026
    expect((await getBalances(db, lina.id, 2026)).find((b) => b.type === 'sick')!.entitlement).toBe(14);
  });

  it('HR adjustments (e.g. carry-over) add to the balance', async () => {
    const { lina, khaled } = await setup();
    expect((await addAdjustment(db, khaled.id, { employeeId: lina.id, year: 2026, type: 'annual', days: 3, reason: 'Carry-over from 2025' })).ok).toBe(true);
    expect((await annual(lina.id)).available).toBe(17);
  });
});

describe('requesting leave', () => {
  it('previews the days used, skipping weekends and client holidays', async () => {
    const { lina } = await setup();
    // Sun 20 – Sat 26 Sep: Wed 23 is Saudi National Day, Fri/Sat weekend → 4 days.
    const p = await previewRequest(db, lina.id, { type: 'annual', fromDate: '2026-09-20', toDate: '2026-09-26' });
    if (!p.ok) throw new Error(p.error);
    expect(p.value.daysUsed).toBe(4);
    expect(p.value.balanceAfter).toBe(10);
  });

  it('refuses no-working-day ranges, overlaps, cross-year and over-balance annual leave', async () => {
    const { lina } = await setup();
    expect(await createRequest(db, lina, { type: 'annual', fromDate: '2026-09-25', toDate: '2026-09-26' })).toMatchObject({ error: 'no_working_days' });
    expect((await createRequest(db, lina, { type: 'annual', fromDate: '2026-10-04', toDate: '2026-10-05' })).ok).toBe(true);
    expect(await createRequest(db, lina, { type: 'annual', fromDate: '2026-10-05', toDate: '2026-10-06' })).toMatchObject({ error: 'leave_overlap' });
    expect(await createRequest(db, lina, { type: 'annual', fromDate: '2026-12-30', toDate: '2027-01-03' })).toMatchObject({ error: 'cross_year' });
    expect(await createRequest(db, lina, { type: 'annual', fromDate: '2026-11-01', toDate: '2026-11-30' })).toMatchObject({ error: 'insufficient_balance' });
    // Unpaid leave has no balance to run out of.
    expect((await createRequest(db, lina, { type: 'unpaid', fromDate: '2026-11-01', toDate: '2026-11-30' })).ok).toBe(true);
  });

  it('pending requests reduce what is available', async () => {
    const { lina } = await setup();
    await createRequest(db, lina, { type: 'annual', fromDate: '2026-10-04', toDate: '2026-10-05' });
    const b = await annual(lina.id);
    expect(b.pending).toBe(2);
    expect(b.available).toBe(12);
  });
});

describe('approving', () => {
  it('approved leave lands on the timesheet and counts as taken', async () => {
    const { lina, khaled } = await setup();
    const id = await createRequest(db, lina, { type: 'annual', fromDate: '2026-09-20', toDate: '2026-09-24', note: 'Family trip' });
    if (!id.ok) throw new Error(id.error);
    expect(await listPendingLeave(db, khaled)).toHaveLength(1);
    expect((await decideRequest(db, khaled, id.value, 'approve', null)).ok).toBe(true);

    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    expect(m.value.summary.totals.leaveDaysByType).toEqual({ annual: 4 });
    expect(m.value.summary.days.find((d) => d.day.date === '2026-09-23')!.entry.leave).toBeUndefined(); // holiday stays a holiday
    const b = await annual(lina.id);
    expect(b.taken).toBe(4);
    expect(b.pending).toBe(0);
    expect(b.available).toBe(10);
  });

  it('a half day records half the hours', async () => {
    const { lina, khaled } = await setup();
    const id = await createRequest(db, lina, { type: 'annual', fromDate: '2026-09-21', toDate: '2026-09-21', halfDay: true });
    if (!id.ok) throw new Error(id.error);
    await decideRequest(db, khaled, id.value, 'approve', null);
    const m = await getMonth(db, lina, lina.id, 2026, 9);
    if (!m.ok) throw new Error(m.error);
    const day = m.value.summary.days.find((d) => d.day.date === '2026-09-21')!;
    expect(day.entry.workedMinutes).toBe(240);
    expect((await annual(lina.id)).taken).toBe(0.5);
  });

  it('only the direct manager decides, and not on a submitted month', async () => {
    const { lina, omar, khaled } = await setup();
    const id = await createRequest(db, lina, { type: 'sick', fromDate: '2026-09-21', toDate: '2026-09-21' });
    if (!id.ok) throw new Error(id.error);
    expect(await decideRequest(db, omar, id.value, 'approve', null)).toMatchObject({ error: 'forbidden' });
    expect(await decideRequest(db, lina, id.value, 'approve', null)).toMatchObject({ error: 'forbidden' });
    await submitMonth(db, lina, lina.id, 2026, 9, '2026-09-24');
    expect(await decideRequest(db, khaled, id.value, 'approve', null)).toMatchObject({ error: 'month_locked' });
    expect((await decideRequest(db, khaled, id.value, 'decline', 'Use the timesheet for this one')).ok).toBe(true);
  });

  it('shows teammates who are off on the same dates', async () => {
    const { lina, omar } = await setup();
    await createRequest(db, omar, { type: 'annual', fromDate: '2026-10-05', toDate: '2026-10-07' });
    const off = await teamOff(db, lina.id, '2026-10-06', '2026-10-08');
    expect(off.map((o) => o.employeeId)).toEqual([omar.id]);
  });
});

describe('cancelling', () => {
  it('cancels pending leave, and approved future leave comes back off the timesheet', async () => {
    const { lina, khaled, omar } = await setup();
    const id = await createRequest(db, lina, { type: 'annual', fromDate: '2026-10-04', toDate: '2026-10-05' });
    if (!id.ok) throw new Error(id.error);
    await decideRequest(db, khaled, id.value, 'approve', null);
    expect((await annual(lina.id)).taken).toBe(2);
    expect(await cancelRequest(db, omar, id.value, '2026-09-24')).toMatchObject({ error: 'forbidden' });
    expect((await cancelRequest(db, lina, id.value, '2026-09-24')).ok).toBe(true);
    expect((await annual(lina.id)).taken).toBe(0);
  });

  it('refuses to cancel approved leave that has already started', async () => {
    const { lina, khaled } = await setup();
    const id = await createRequest(db, lina, { type: 'annual', fromDate: '2026-09-21', toDate: '2026-09-22' });
    if (!id.ok) throw new Error(id.error);
    await decideRequest(db, khaled, id.value, 'approve', null);
    expect((await cancelRequest(db, lina, id.value, '2026-09-24')).ok).toBe(false);
  });
});
