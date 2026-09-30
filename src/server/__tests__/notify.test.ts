import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { en } from '@/i18n/en';
import { ar } from '@/i18n/ar';
import { notificationText } from '@/lib/notificationText';
import { createCalendar, createClient } from '../clients';
import { createRequest, decideRequest } from '../leave';
import { countUnread, listNotifications, markAllRead } from '../notify';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { setSetting } from '../settings';
import * as ts from '../timesheets';
import type { Actor } from '../timesheets';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, notifications, leave_requests, day_change_requests, day_entries, timesheets, assignments, schedules, clients, calendars, settings, employees CASCADE`);
});

async function setup() {
  const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
  if (!cal.ok) throw new Error('cal');
  const client = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
  if (!client.ok) throw new Error('client');
  await setSetting(db, 'hoursSource', []);
  const make = async (email: string, managerId: string | null, roles: ('admin' | 'hr')[] = []) => {
    const r = await createEmployee(db, null, { email, nameEn: email.split('@')[0]!, managerId, roles, hireDate: '2022-01-01' });
    if (!r.ok) throw new Error(r.error);
    await addAssignment(db, null, { employeeId: r.value.id, clientId: client.value, startDate: '2026-01-01' });
    await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
    return { id: r.value.id, roles: r.value.roles } as Actor;
  };
  const gm = await make('huda@ems.com', null, ['admin']);
  const reem = await make('reem@ems.com', gm.id);
  const yousef = await make('yousef@ems.com', reem.id);
  return { gm, reem, yousef };
}

describe('notifications', () => {
  it('a leave request tells the manager; the decision tells the employee', async () => {
    const { reem, yousef } = await setup();
    const req = await createRequest(db, yousef, { type: 'annual', fromDate: '2026-10-04', toDate: '2026-10-05' });
    if (!req.ok) throw new Error(req.error);
    const [toManager] = await listNotifications(db, reem.id);
    expect(toManager).toMatchObject({ kind: 'leave_requested', link: `/approvals?l=${req.value}` });
    expect(notificationText(en, 'en', 'leave_requested', toManager!.data as Record<string, unknown>).title).toBe('yousef requested time off');

    await decideRequest(db, reem, req.value, 'approve', null);
    const [toEmployee] = await listNotifications(db, yousef.id);
    expect(toEmployee).toMatchObject({ kind: 'leave_decided', link: '/time-off' });
    expect(notificationText(en, 'en', 'leave_decided', toEmployee!.data as Record<string, unknown>).title).toBe('Your time off was approved');
    expect(notificationText(ar, 'ar', 'leave_decided', toEmployee!.data as Record<string, unknown>).title).toContain('اعتُمد');
  });

  it('day changes and month submissions go to the manager; someone with no manager goes to the admins', async () => {
    const { gm, reem, yousef } = await setup();
    await ts.saveDay(db, yousef, yousef.id, { date: '2026-09-15', workedMinutes: 600 });
    await ts.saveDay(db, yousef, yousef.id, { date: '2026-09-15', workedMinutes: 660 }); // an edit of the same request: no second ping
    expect((await listNotifications(db, reem.id)).map((n) => n.kind)).toEqual(['day_change_requested']);

    await ts.submitMonth(db, reem, reem.id, 2026, 9, '2026-09-28');
    expect((await listNotifications(db, gm.id)).map((n) => n.kind)).toEqual(['month_submitted']);
  });

  it('counts unread and marks them read', async () => {
    const { reem, yousef } = await setup();
    await createRequest(db, yousef, { type: 'annual', fromDate: '2026-10-04', toDate: '2026-10-04' });
    expect(await countUnread(db, reem.id)).toBe(1);
    await markAllRead(db, reem.id);
    expect(await countUnread(db, reem.id)).toBe(0);
  });
});
