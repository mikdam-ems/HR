import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { resolveDay } from '@/domain';
import { createCalendar, createClient } from '../clients';
import { addAssignment, createEmployee } from '../people';
import { loadRulesContext } from '../rulesContext';
import { createShift, deactivateShift, listShifts, shiftRoster, updateShift } from '../shifts';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, schedules, assignments, client_shifts, clients, calendars, employees CASCADE`);
});

async function setup() {
  const cal = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4, 5, 6] });
  if (!cal.ok) throw new Error('cal');
  const hala = await createClient(db, null, { nameEn: 'Hala', calendarId: cal.value });
  if (!hala.ok) throw new Error('client');
  const [standard] = await listShifts(db, hala.value);
  const a = await createShift(db, null, { clientId: hala.value, name: 'Shift A', startTime: '06:00', endTime: '14:00', sortOrder: 1 });
  const b = await createShift(db, null, { clientId: hala.value, name: 'Shift B', startTime: '14:00', endTime: '22:00', sortOrder: 2 });
  const c = await createShift(db, null, { clientId: hala.value, name: 'Shift C', startTime: '22:00', endTime: '06:00', sortOrder: 3 });
  if (!a.ok || !b.ok || !c.ok) throw new Error('shift');
  const person = await createEmployee(db, null, { email: 'omar@ems.com', nameEn: 'Omar' });
  if (!person.ok) throw new Error('person');
  return { hala: hala.value, standard: standard!, a: a.value, b: b.value, c: c.value, omar: person.value.id };
}

describe('client shifts', () => {
  it('a new client starts with a Standard 09:00–17:30 shift', async () => {
    const { hala } = await setup();
    const shifts = await listShifts(db, hala);
    expect(shifts.map((s) => s.name)).toEqual(['Standard', 'Shift A', 'Shift B', 'Shift C']);
    expect(shifts[0]).toMatchObject({ startTime: '09:00', endTime: '17:30' });
  });

  it('assigning someone to a client on a shift sets their schedule, including a night shift', async () => {
    const { hala, c, omar } = await setup();
    expect((await addAssignment(db, null, { employeeId: omar, clientId: hala, startDate: '2026-09-01', shiftId: c })).ok).toBe(true);
    const day = resolveDay(await loadRulesContext(db), omar, '2026-09-15');
    expect(day.schedule).toMatchObject({ start: '22:00', end: '06:00', shiftCode: 'Shift C' });
    expect(day.expectedMinutes).toBe(8 * 60);
    expect((await shiftRoster(db, hala, '2026-09-15'))[c]).toEqual([omar]);
  });

  it("refuses a shift from another client", async () => {
    const { a, omar } = await setup();
    const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
    if (!cal.ok) throw new Error('cal');
    const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
    if (!jadwa.ok) throw new Error('client');
    expect(await addAssignment(db, null, { employeeId: omar, clientId: jadwa.value, startDate: '2026-09-01', shiftId: a })).toMatchObject({
      error: 'unknown_shift',
    });
  });

  it('changing a shift moves everyone on it from that day, keeping earlier days', async () => {
    const { hala, a, omar } = await setup();
    await addAssignment(db, null, { employeeId: omar, clientId: hala, startDate: '2026-09-01', shiftId: a });
    expect(
      (await updateShift(db, null, a, { clientId: hala, name: 'Shift A', startTime: '07:00', endTime: '15:30' }, '2026-09-20')).ok,
    ).toBe(true);
    const ctx = await loadRulesContext(db);
    expect(resolveDay(ctx, omar, '2026-09-10').schedule).toMatchObject({ start: '06:00', end: '14:00' });
    expect(resolveDay(ctx, omar, '2026-09-25').schedule).toMatchObject({ start: '07:00', end: '15:30' });
  });

  it('a retired shift leaves pickers but not the people on it', async () => {
    const { hala, b, omar } = await setup();
    await addAssignment(db, null, { employeeId: omar, clientId: hala, startDate: '2026-09-01', shiftId: b });
    await deactivateShift(db, null, b);
    expect((await listShifts(db, hala)).map((s) => s.name)).not.toContain('Shift B');
    expect(resolveDay(await loadRulesContext(db), omar, '2026-09-15').schedule).toMatchObject({ start: '14:00' });
  });
});
