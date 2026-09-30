import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { ammanInstant } from '@/lib/format';
import { createCalendar, createClient } from '../clients';
import { clock, clockOutAt } from '../clock';
import { runDaily } from '../daily';
import { listNotifications } from '../notify';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { setSetting } from '../settings';
import * as ts from '../timesheets';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, clock_events, notifications, day_entries, timesheets, assignments, schedules, clients, calendars, settings, employees CASCADE`);
});

// 2026-09-30 is a Wednesday, the last Sunday–Thursday working day of September is Wed 30th.
const at = (date: string) => new Date(`${date}T05:00:00Z`);

async function person(email: string, clientId: string) {
  const r = await createEmployee(db, null, { email, nameEn: email.split('@')[0]!, hireDate: '2022-01-01' });
  if (!r.ok) throw new Error(r.error);
  await addAssignment(db, null, { employeeId: r.value.id, clientId, startDate: '2026-01-01' });
  await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
  return r.value;
}

describe('runDaily', () => {
  it('reminds people with an unsubmitted month on their last working day, once', async () => {
    const cal = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4] });
    if (!cal.ok) throw new Error('cal');
    const client = await createClient(db, null, { nameEn: 'Hala', calendarId: cal.value });
    if (!client.ok) throw new Error('client');
    await setSetting(db, 'hoursSource', []);
    const yousef = await person('yousef@ems.com', client.value);
    const maya = await person('maya@ems.com', client.value);
    const submitted = await ts.submitMonth(db, { id: maya.id, roles: maya.roles }, maya.id, 2026, 9);
    expect(submitted.ok).toBe(true);

    expect((await runDaily(db, at('2026-09-29'))).reminded).toBe(0);
    expect((await runDaily(db, at('2026-09-30'))).reminded).toBe(1);
    expect((await runDaily(db, at('2026-09-30'))).reminded).toBe(0);

    const [note] = await listNotifications(db, yousef.id);
    expect(note).toMatchObject({ kind: 'timesheet_reminder', link: '/timesheet?month=2026-09' });
    expect(await listNotifications(db, maya.id)).toHaveLength(0);
  });

  it('counts today’s birthdays and anniversaries (no Slack post without a channel)', async () => {
    await createEmployee(db, null, { email: 'a@ems.com', nameEn: 'A', hireDate: '2021-09-28' });
    const b = await createEmployee(db, null, { email: 'b@ems.com', nameEn: 'B', birthDate: '1994-09-28' });
    expect(b.ok).toBe(true);
    expect(await runDaily(db, at('2026-09-28'))).toEqual({ reminded: 0, nudged: 0, celebrations: 2, posted: false });
  });

  it('nudges someone still clocked in from yesterday, once, but not a night shift that is still running', async () => {
    const cal = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4] });
    if (!cal.ok) throw new Error('cal');
    const client = await createClient(db, null, { nameEn: 'Hala', calendarId: cal.value });
    if (!client.ok) throw new Error('client');
    const local = (s: string) => ammanInstant(s.slice(0, 10), s.slice(11, 16));
    const yousef = await person('yousef@ems.com', client.value);
    const hala = await person('hala@ems.com', client.value);
    await setSchedule(db, null, { employeeId: hala.id, effectiveFrom: '2026-01-01', startTime: '23:00', endTime: '09:00' });
    const maya = await person('maya@ems.com', client.value);

    await clock(db, yousef.id, 'in', local('2026-09-28 09:00')); // forgot to clock out
    await clock(db, hala.id, 'in', local('2026-09-28 23:00')); // night shift, ends 09:00
    await clock(db, maya.id, 'in', local('2026-09-28 09:00'));
    await clock(db, maya.id, 'out', local('2026-09-28 17:30'));

    // The cron runs at 08:00 Amman.
    expect((await runDaily(db, local('2026-09-29 08:00'))).nudged).toBe(1);
    expect((await runDaily(db, local('2026-09-29 08:00'))).nudged).toBe(0);
    const [note] = await listNotifications(db, yousef.id);
    expect(note).toMatchObject({ kind: 'clock_open', link: '/', data: { date: '2026-09-28' } });
    expect(await listNotifications(db, hala.id)).toHaveLength(0);
    expect(await listNotifications(db, maya.id)).toHaveLength(0);

    // Next morning Hala still hasn't clocked out: now she's nudged. Yousef, who fixed his day, isn't again.
    expect((await clockOutAt(db, yousef.id, '2026-09-28', '17:30', local('2026-09-29 09:00'))).ok).toBe(true);
    expect((await runDaily(db, local('2026-09-30 08:00'))).nudged).toBe(1);
    const nudges = async (id: string) => (await listNotifications(db, id)).filter((n) => n.kind === 'clock_open');
    expect(await nudges(hala.id)).toHaveLength(1);
    expect(await nudges(yousef.id)).toHaveLength(1);
  });
});
