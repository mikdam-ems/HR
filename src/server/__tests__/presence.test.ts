import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import type { Employee } from '@/db/schema';
import { ammanInstant } from '@/lib/format';
import { createCalendar, createClient } from '../clients';
import { clock, clockView } from '../clock';
import { createRequest, decideRequest } from '../leave';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { todayBoard } from '../presence';

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

// 29 September 2026 is a Tuesday; the client works Sunday–Thursday, 09:00–17:30.
async function team() {
  const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
  if (!cal.ok) throw new Error('calendar');
  const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
  if (!jadwa.ok) throw new Error('client');
  const boss = await createEmployee(db, null, { email: 'boss@ems.com', nameEn: 'Boss', roles: ['admin'] });
  if (!boss.ok) throw new Error(boss.error);
  const make = async (name: string): Promise<Employee> => {
    const r = await createEmployee(db, null, { email: `${name}@ems.com`, nameEn: name, managerId: boss.value.id, hireDate: '2022-01-01' });
    if (!r.ok) throw new Error(r.error);
    await addAssignment(db, null, { employeeId: r.value.id, clientId: jadwa.value, startDate: '2026-01-01' });
    await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
    return r.value;
  };
  return { boss: boss.value, rama: await make('rama'), omar: await make('omar'), lina: await make('lina'), sami: await make('sami') };
}

describe('todayBoard', () => {
  it('puts everyone in one state, with where they work and when they started', async () => {
    const { boss, rama, omar, lina, sami } = await team();
    await clock(db, rama.id, 'in', t('2026-09-29 08:55'), 'web', 'remote');
    await clock(db, omar.id, 'in', t('2026-09-29 09:40'), 'slack', 'client_site');
    await clock(db, omar.id, 'break_start', t('2026-09-29 09:50'));
    const leave = await createRequest(db, { id: sami.id, roles: sami.roles }, { type: 'annual', fromDate: '2026-09-29', toDate: '2026-09-30' });
    if (!leave.ok) throw new Error(leave.error);
    expect((await decideRequest(db, { id: boss.id, roles: boss.roles }, leave.value, 'approve', null)).ok).toBe(true);

    const board = await todayBoard(db, [rama, omar, lina, sami], t('2026-09-29 10:00'));
    const of = (p: Employee) => board.find((r) => r.employee.id === p.id)!;

    expect(of(rama)).toMatchObject({ presence: { status: 'working', lateBy: 0 }, location: 'remote' });
    expect(of(rama).since).toEqual(t('2026-09-29 08:55'));
    expect(of(omar)).toMatchObject({ presence: { status: 'break', lateBy: 40 }, location: 'client_site' });
    expect(of(lina)).toMatchObject({ presence: { status: 'late', lateBy: 60 }, location: null });
    expect(of(sami)).toMatchObject({ presence: { status: 'on_leave' }, leavePortion: 1 });

    const evening = await todayBoard(db, [rama, lina], t('2026-09-29 18:00'));
    expect(evening.map((r) => r.presence.status)).toEqual(['working', 'absent']);
  });

  it('shows a weekend as a day off, and yesterday’s clock-in as nothing for today', async () => {
    const { rama } = await team();
    await clock(db, rama.id, 'in', t('2026-10-01 09:00'), 'web', 'office');
    await clock(db, rama.id, 'out', t('2026-10-01 17:30'));
    // Friday 2 October.
    const [friday] = await todayBoard(db, [rama], t('2026-10-02 11:00'));
    expect(friday).toMatchObject({ presence: { status: 'off' }, location: null, firstIn: null });
  });
});

describe('work location', () => {
  it('is kept from last time when clocking in without choosing', async () => {
    const { rama } = await team();
    expect((await clockView(db, rama.id, t('2026-09-28 08:00'))).usualLocation).toBeNull();
    await clock(db, rama.id, 'in', t('2026-09-28 09:00'), 'web', 'client_site');
    expect(await clockView(db, rama.id, t('2026-09-28 10:00'))).toMatchObject({ location: 'client_site', usualLocation: 'client_site' });
    await clock(db, rama.id, 'out', t('2026-09-28 17:30'));
    expect(await clockView(db, rama.id, t('2026-09-28 18:00'))).toMatchObject({ location: null, usualLocation: 'client_site' });

    await clock(db, rama.id, 'in', t('2026-09-29 09:00'));
    expect((await clockView(db, rama.id, t('2026-09-29 10:00'))).location).toBe('client_site');
    await clock(db, rama.id, 'break_start', t('2026-09-29 12:00'), 'web', 'remote');
    expect((await clockView(db, rama.id, t('2026-09-29 12:10'))).location).toBe('client_site');
  });
});
