import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { monthClosures } from '@/db/schema';
import { resolveDay } from '@/domain';
import { ammanInstant } from '@/lib/format';
import { createCalendar, createClient } from '../clients';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { todayBoard } from '../presence';
import { loadRulesContext } from '../rulesContext';
import { createSeason, deleteSeason } from '../seasons';
import { createShift } from '../shifts';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, month_closures, seasonal_hours, client_shifts, clock_events, assignments, schedules, clients, calendars, settings, employees CASCADE`,
  );
});

async function setup() {
  const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
  if (!cal.ok) throw new Error('calendar');
  const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
  if (!jadwa.ok) throw new Error('client');
  const maya = await createEmployee(db, null, { email: 'maya@ems.com', nameEn: 'Maya' });
  if (!maya.ok) throw new Error(maya.error);
  await addAssignment(db, null, { employeeId: maya.value.id, clientId: jadwa.value, startDate: '2026-01-01' });
  await setSchedule(db, null, { employeeId: maya.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
  return { clientId: jadwa.value, maya: maya.value };
}

const ramadan = (clientId: string, over: Record<string, string> = {}) => ({
  clientId,
  name: 'Ramadan 2027',
  fromDate: '2027-02-07',
  toDate: '2027-03-08',
  startTime: '09:00',
  endTime: '15:00',
  ...over,
});

describe('seasonal hours', () => {
  it('change the expected hours, and Late / Absent on the Today board, during the range', async () => {
    const { clientId, maya } = await setup();
    expect((await createSeason(db, null, ramadan(clientId))).ok).toBe(true);
    const ctx = await loadRulesContext(db);
    expect(resolveDay(ctx, maya.id, '2027-02-08')).toMatchObject({ expectedMinutes: 360, seasonName: 'Ramadan 2027' });
    expect(resolveDay(ctx, maya.id, '2027-03-09').expectedMinutes).toBe(510);

    // 15:00 is the end of a Ramadan day: someone who never came is absent then, not "late".
    const [row] = await todayBoard(db, [maya], ammanInstant('2027-02-08', '15:00'));
    expect(row!.presence.status).toBe('absent');
  });

  it('refuses overlapping periods for the same people, but allows them for different shifts', async () => {
    const { clientId } = await setup();
    const a = await createShift(db, null, { clientId, name: 'A', startTime: '06:00', endTime: '14:00' });
    const b = await createShift(db, null, { clientId, name: 'B', startTime: '14:00', endTime: '22:00' });
    if (!a.ok || !b.ok) throw new Error('shift');
    expect((await createSeason(db, null, ramadan(clientId, { clientShiftId: a.value }))).ok).toBe(true);
    expect((await createSeason(db, null, ramadan(clientId, { clientShiftId: b.value, startTime: '13:00', endTime: '19:00' }))).ok).toBe(true);
    expect(await createSeason(db, null, ramadan(clientId, { fromDate: '2027-03-01', toDate: '2027-03-31' }))).toMatchObject({
      error: 'season_overlap',
    });
  });

  it('checks dates and hours', async () => {
    const { clientId } = await setup();
    expect(await createSeason(db, null, ramadan(clientId, { toDate: '2027-02-01' }))).toMatchObject({ error: 'end_before_start' });
    expect(await createSeason(db, null, ramadan(clientId, { endTime: '09:00' }))).toMatchObject({ error: 'invalid_input' });
    expect(await createSeason(db, null, ramadan(clientId, { toDate: '2027-12-31' }))).toMatchObject({ error: 'invalid_input' });
  });

  it('never touches a month that is closed for payroll', async () => {
    const { clientId } = await setup();
    const id = await createSeason(db, null, ramadan(clientId));
    if (!id.ok) throw new Error(id.error);
    await db.insert(monthClosures).values({ year: 2027, month: 3 });
    expect(await deleteSeason(db, null, id.value)).toMatchObject({ error: 'month_closed' });
    expect(await createSeason(db, null, ramadan(clientId, { fromDate: '2027-03-10', toDate: '2027-03-20' }))).toMatchObject({
      error: 'month_closed',
    });
  });
});
