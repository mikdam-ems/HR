import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { createCalendar, createClient } from '../clients';
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
  await db.execute(sql`TRUNCATE audit_log, notifications, day_entries, timesheets, assignments, schedules, clients, calendars, settings, employees CASCADE`);
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
    await setSetting(db, 'hoursSource', 'schedule');
    const moath = await person('moath@ems.com', client.value);
    const rama = await person('rama@ems.com', client.value);
    const submitted = await ts.submitMonth(db, { id: rama.id, roles: rama.roles }, rama.id, 2026, 9);
    expect(submitted.ok).toBe(true);

    expect((await runDaily(db, at('2026-09-29'))).reminded).toBe(0);
    expect((await runDaily(db, at('2026-09-30'))).reminded).toBe(1);
    expect((await runDaily(db, at('2026-09-30'))).reminded).toBe(0);

    const [note] = await listNotifications(db, moath.id);
    expect(note).toMatchObject({ kind: 'timesheet_reminder', link: '/timesheet?month=2026-09' });
    expect(await listNotifications(db, rama.id)).toHaveLength(0);
  });

  it('counts today’s birthdays and anniversaries (no Slack post without a channel)', async () => {
    await createEmployee(db, null, { email: 'a@ems.com', nameEn: 'A', hireDate: '2021-09-28' });
    const b = await createEmployee(db, null, { email: 'b@ems.com', nameEn: 'B', birthDate: '1994-09-28' });
    expect(b.ok).toBe(true);
    expect(await runDaily(db, at('2026-09-28'))).toEqual({ reminded: 0, celebrations: 2, posted: false });
  });
});
