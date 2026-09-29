import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { timesheets } from '@/db/schema';
import { addDays, resolveDay } from '@/domain';
import { todayISO } from '@/lib/format';
import { createCalendar, createClient } from '../clients';
import { listNotifications } from '../notify';
import { addAssignment, createEmployee, setSchedule } from '../people';
import { loadRulesContext } from '../rulesContext';
import { cancelSwap, decideSwap, listPendingSwaps, mySwaps, requestSwap, respondSwap } from '../swaps';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, shift_swaps, notifications, leave_requests, timesheets, assignments, schedules, clients, calendars, settings, employees CASCADE`,
  );
});

// A 24/7 client: every day is a working day. Omar works mornings, Lina and Sami evenings.
const day = addDays(todayISO(), 3);

async function team() {
  const cal = await createCalendar(db, null, { name: '24/7', workWeek: [0, 1, 2, 3, 4, 5, 6] });
  if (!cal.ok) throw new Error('calendar');
  const client = await createClient(db, null, { nameEn: 'Hala', calendarId: cal.value });
  const other = await createClient(db, null, { nameEn: 'Other', calendarId: cal.value });
  if (!client.ok || !other.ok) throw new Error('client');
  const boss = await createEmployee(db, null, { email: 'khaled@ems.com', nameEn: 'khaled' });
  if (!boss.ok) throw new Error(boss.error);
  const make = async (name: string, start: string, end: string, clientId = client.value) => {
    const r = await createEmployee(db, null, { email: `${name}@ems.com`, nameEn: name, managerId: boss.value.id, hireDate: '2020-01-01' });
    if (!r.ok) throw new Error(r.error);
    await addAssignment(db, null, { employeeId: r.value.id, clientId, startDate: '2020-01-01' });
    await setSchedule(db, null, { employeeId: r.value.id, effectiveFrom: '2020-01-01', startTime: start, endTime: end });
    return r.value;
  };
  return {
    khaled: boss.value,
    omar: await make('omar', '07:00', '15:00'),
    lina: await make('lina', '15:00', '23:00'),
    sami: await make('sami', '15:00', '23:00'),
    nour: await make('nour', '07:00', '15:00', other.value),
  };
}

describe('shift swaps', () => {
  it('asked → accepted → approved, and then each works the other’s shift that day', async () => {
    const { khaled, omar, lina } = await team();
    const id = await requestSwap(db, omar, { colleagueId: lina.id, date: day, note: 'Doctor in the morning' });
    if (!id.ok) throw new Error(id.error);
    expect((await listNotifications(db, lina.id))[0]).toMatchObject({ kind: 'swap_requested', data: { name: 'omar', date: day } });

    // Not the manager's to decide until Lina agrees; and Lina can't approve it herself.
    expect(await decideSwap(db, khaled, id.value, 'approve')).toMatchObject({ error: 'already_decided' });
    expect(await respondSwap(db, omar, id.value, 'accept')).toMatchObject({ error: 'forbidden' });
    expect((await respondSwap(db, lina, id.value, 'accept')).ok).toBe(true);
    expect((await listNotifications(db, khaled.id))[0]).toMatchObject({ kind: 'swap_accepted', data: { name: 'omar', other: 'lina' } });
    expect((await listPendingSwaps(db, khaled)).map((x) => x.swap.id)).toEqual([id.value]);
    expect(await listPendingSwaps(db, lina)).toEqual([]);

    expect((await decideSwap(db, khaled, id.value, 'approve')).ok).toBe(true);
    const ctx = await loadRulesContext(db);
    expect(resolveDay(ctx, omar.id, day)).toMatchObject({ schedule: { start: '15:00', end: '23:00' }, swappedWith: lina.id });
    expect(resolveDay(ctx, lina.id, day).schedule).toMatchObject({ start: '07:00', end: '15:00' });
    expect(resolveDay(ctx, omar.id, addDays(day, 1)).schedule).toMatchObject({ start: '07:00' });
    for (const who of [omar.id, lina.id]) {
      expect((await listNotifications(db, who))[0]).toMatchObject({ kind: 'swap_decided', data: { outcome: 'approved' } });
    }
    expect((await mySwaps(db, lina.id)).map((s) => s.status)).toEqual(['approved']);
    expect(await cancelSwap(db, omar, id.value)).toMatchObject({ error: 'already_decided' });
  });

  it('refuses swaps that make no sense', async () => {
    const { omar, lina, sami, nour } = await team();
    const ask = (colleagueId: string, date = day, who = omar) => requestSwap(db, who, { colleagueId, date });
    expect(await ask(omar.id)).toMatchObject({ error: 'swap_not_possible' }); // with yourself
    expect(await ask(lina.id, addDays(todayISO(), -1))).toMatchObject({ error: 'swap_not_possible' }); // in the past
    expect(await ask(sami.id, day, lina)).toMatchObject({ error: 'swap_not_possible' }); // same hours
    expect(await ask(nour.id)).toMatchObject({ error: 'swap_not_possible' }); // another client
    expect((await ask(lina.id)).ok).toBe(true);
    expect(await ask(sami.id)).toMatchObject({ error: 'swap_not_possible' }); // Omar is already swapping that day
  });

  it('can be declined by the colleague or withdrawn by the requester', async () => {
    const { omar, lina, sami } = await team();
    const a = await requestSwap(db, omar, { colleagueId: lina.id, date: day });
    if (!a.ok) throw new Error(a.error);
    expect((await respondSwap(db, lina, a.value, 'decline')).ok).toBe(true);
    expect((await listNotifications(db, omar.id))[0]).toMatchObject({ kind: 'swap_decided', data: { outcome: 'declined' } });

    const b = await requestSwap(db, omar, { colleagueId: sami.id, date: day });
    if (!b.ok) throw new Error(b.error);
    expect(await cancelSwap(db, sami, b.value)).toMatchObject({ error: 'forbidden' });
    expect((await cancelSwap(db, omar, b.value)).ok).toBe(true);
    expect(await mySwaps(db, omar.id)).toEqual([]);
  });

  it('isn’t possible once a month is submitted', async () => {
    const { omar, lina } = await team();
    await db.insert(timesheets).values({ employeeId: lina.id, year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), status: 'submitted' });
    expect(await requestSwap(db, omar, { colleagueId: lina.id, date: day })).toMatchObject({ error: 'month_locked' });
  });
});
