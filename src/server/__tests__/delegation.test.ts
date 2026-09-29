import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { auditLog } from '@/db/schema';
import { addDays } from '@/domain';
import { en } from '@/i18n/en';
import { todayISO } from '@/lib/format';
import { notificationText, type NotificationKind } from '@/lib/notificationText';
import { createCalendar, createClient } from '../clients';
import { cancelDelegation, createDelegation, standingInFor } from '../delegation';
import { createRequest, decideRequest, listPendingLeave } from '../leave';
import { listNotifications } from '../notify';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { decidesFor, onBehalfOf } from '../permissions';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, approval_delegations, notifications, leave_requests, day_entries, assignments, schedules, clients, calendars, settings, employees CASCADE`,
  );
});

const today = todayISO();

async function team() {
  const cal = await createCalendar(db, null, { name: 'Every day', workWeek: [0, 1, 2, 3, 4, 5, 6] });
  if (!cal.ok) throw new Error('calendar');
  const client = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
  if (!client.ok) throw new Error('client');
  const make = async (name: string, managerId: string | null = null, roles: ('hr' | 'admin')[] = []) => {
    const r = await createEmployee(db, null, { email: `${name}@ems.com`, nameEn: name, managerId, roles, hireDate: '2020-01-01' });
    if (!r.ok) throw new Error(r.error);
    await addAssignment(db, null, { employeeId: r.value.id, clientId: client.value, startDate: '2020-01-01' });
    await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2020-01-01', startTime: '09:00', endTime: '17:00' });
    return r.value;
  };
  const khaled = await make('khaled');
  const lina = await make('lina', khaled.id);
  const omar = await make('omar', khaled.id);
  const hr = await make('hr', null, ['hr']);
  return { khaled, lina, omar, hr };
}

/** How the app sees someone when they sign in today. */
const signedIn = async (p: { id: string; roles: ('employee' | 'hr' | 'finance' | 'admin')[] }) => ({
  id: p.id,
  roles: p.roles,
  standingInFor: await standingInFor(db, p.id),
});

describe('handing approvals to a stand-in', () => {
  it('only the manager or People & Culture can arrange it, one stand-in at a time', async () => {
    const { khaled, lina, omar, hr } = await team();
    const week = { managerId: khaled.id, deputyId: omar.id, fromDate: today, toDate: addDays(today, 6) };
    expect(await createDelegation(db, lina, week)).toMatchObject({ error: 'forbidden' });
    expect(await createDelegation(db, khaled, { ...week, deputyId: khaled.id })).toMatchObject({ error: 'invalid_input' });
    expect(await createDelegation(db, khaled, { ...week, fromDate: addDays(today, -9), toDate: addDays(today, -2) })).toMatchObject({
      error: 'invalid_input',
    });
    const id = await createDelegation(db, hr, week);
    expect(id.ok).toBe(true);
    expect(await createDelegation(db, khaled, { ...week, deputyId: lina.id })).toMatchObject({ error: 'delegation_overlap' });

    expect(await standingInFor(db, omar.id)).toEqual([khaled.id]);
    expect(await standingInFor(db, omar.id, addDays(today, 7))).toEqual([]);
    if (!id.ok) return;
    expect(await cancelDelegation(db, lina, id.value)).toMatchObject({ error: 'forbidden' });
    expect((await cancelDelegation(db, khaled, id.value)).ok).toBe(true);
    expect(await standingInFor(db, omar.id)).toEqual([]);
  });

  it('the stand-in is asked, decides once, and the decision says for whom', async () => {
    const { khaled, lina, omar } = await team();
    await createDelegation(db, khaled, { managerId: khaled.id, deputyId: omar.id, fromDate: today, toDate: addDays(today, 3) });
    const standIn = await signedIn(omar);

    const req = await createRequest(db, lina, { type: 'annual', fromDate: addDays(today, 20), toDate: addDays(today, 20) });
    if (!req.ok) throw new Error(req.error);
    expect((await listNotifications(db, omar.id)).map((n) => n.kind)).toEqual(['leave_requested']);
    expect((await listNotifications(db, khaled.id)).map((n) => n.kind)).toEqual(['leave_requested']);
    expect((await listPendingLeave(db, standIn)).map((l) => l.id)).toEqual([req.value]);

    expect((await decideRequest(db, standIn, req.value, 'approve', null)).ok).toBe(true);
    // The manager can still decide, but nothing is decided twice.
    expect(await decideRequest(db, await signedIn(khaled), req.value, 'decline', null)).toMatchObject({ error: 'already_decided' });

    const [told] = await listNotifications(db, lina.id);
    expect(told).toMatchObject({ kind: 'leave_decided', data: { by: 'omar', for: 'khaled' } });
    const words = notificationText(en, 'en', told!.kind as NotificationKind, told!.data as Record<string, unknown>);
    expect(words.body).toContain('Decided by omar for khaled');
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'leave_request'), eq(auditLog.action, 'approve')));
    expect(entry).toMatchObject({ actorId: omar.id, after: { onBehalfOf: khaled.id } });
  });

  it('never lets a stand-in approve their own request', async () => {
    const { khaled, omar } = await team();
    await createDelegation(db, khaled, { managerId: khaled.id, deputyId: omar.id, fromDate: today, toDate: addDays(today, 3) });
    const req = await createRequest(db, omar, { type: 'annual', fromDate: addDays(today, 20), toDate: addDays(today, 20) });
    if (!req.ok) throw new Error(req.error);
    // Omar isn't even asked about his own leave.
    expect((await listNotifications(db, omar.id)).map((n) => n.kind)).toEqual([]);
    expect(await decideRequest(db, await signedIn(omar), req.value, 'approve', null)).toMatchObject({ error: 'forbidden' });
  });
});

describe('decidesFor', () => {
  const person = { id: 'lina', managerId: 'khaled' };
  it('is the manager or their stand-in, an admin only for people with no manager, never oneself', () => {
    expect(decidesFor({ id: 'khaled', roles: ['employee'] }, person)).toBe(true);
    expect(decidesFor({ id: 'omar', roles: ['employee'], standingInFor: ['khaled'] }, person)).toBe(true);
    expect(decidesFor({ id: 'omar', roles: ['employee'], standingInFor: ['sami'] }, person)).toBe(false);
    expect(decidesFor({ id: 'boss', roles: ['admin'] }, person)).toBe(false);
    expect(decidesFor({ id: 'boss', roles: ['admin'] }, { id: 'gm', managerId: null })).toBe(true);
    expect(decidesFor({ id: 'lina', roles: ['admin'], standingInFor: ['khaled'] }, person)).toBe(false);
  });

  it('says whom a stand-in decided for, and nothing when the manager decides', () => {
    expect(onBehalfOf({ id: 'omar', roles: ['employee'], standingInFor: ['khaled'] }, person)).toBe('khaled');
    expect(onBehalfOf({ id: 'khaled', roles: ['employee'], standingInFor: ['khaled'] }, person)).toBeNull();
  });
});
