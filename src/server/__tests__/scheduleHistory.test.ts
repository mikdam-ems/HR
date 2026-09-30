import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asc, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { schedules } from '@/db/schema';
import { createCalendar, createClient } from '../clients';
import { createEmployee, setSchedule } from '../people';
import { listShifts } from '../shifts';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});

const repair = readFileSync(path.resolve(import.meta.dirname, '../../../drizzle/0018_schedule_history.sql'), 'utf8');

describe('0018 puts schedule history back after 0010 (issue #3)', () => {
  it('past months keep 09:00–17:00; the 8h30 day starts as a new version on 1 October', async () => {
    const person = async (email: string) => {
      const r = await createEmployee(db, null, { email, nameEn: email });
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const [standard, custom, moved] = [await person('a@x.com'), await person('b@x.com'), await person('c@x.com')];
    // What 0010 and 0011 left behind: standard schedules rewritten to 17:30 back to their start, and linked to
    // their client's Standard shift.
    const cal = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
    if (!cal.ok) throw new Error('calendar');
    const jadwa = await createClient(db, null, { nameEn: 'Jadwa', calendarId: cal.value });
    if (!jadwa.ok) throw new Error('client');
    const [standardShift] = await listShifts(db, jadwa.value);
    await setSchedule(db, null, {
      employeeId: standard,
      effectiveFrom: '2026-01-01',
      startTime: '09:00',
      endTime: '17:30',
      shiftCode: 'Standard',
      clientShiftId: standardShift!.id,
    });
    await setSchedule(db, null, { employeeId: custom, effectiveFrom: '2026-01-01', startTime: '10:00', endTime: '18:00' });
    // Someone who moved to a night shift in June: the old version is history only, nothing new from October.
    await setSchedule(db, null, { employeeId: moved, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
    await setSchedule(db, null, { employeeId: moved, effectiveFrom: '2026-06-01', startTime: '22:00', endTime: '06:00' });

    for (const statement of repair.split('--> statement-breakpoint')) await db.execute(sql.raw(statement));

    const rows = await db.select().from(schedules).orderBy(asc(schedules.effectiveFrom));
    const of = (id: string) => rows.filter((r) => r.employeeId === id).map((r) => `${r.effectiveFrom} ${r.startTime}–${r.endTime}`);
    expect(of(standard)).toEqual(['2026-01-01 09:00–17:00', '2026-10-01 09:00–17:30']);
    // The shift link moves to October; the restored history is custom hours, not the 17:30 shift.
    const shiftOf = (id: string) => rows.filter((r) => r.employeeId === id).map((r) => r.clientShiftId);
    expect(shiftOf(standard)).toEqual([null, standardShift!.id]);
    expect(of(custom)).toEqual(['2026-01-01 10:00–18:00']);
    expect(of(moved)).toEqual(['2026-01-01 09:00–17:00', '2026-06-01 22:00–06:00']);
  });
});
