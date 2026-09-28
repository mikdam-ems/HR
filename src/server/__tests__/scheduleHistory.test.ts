import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asc, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { schedules } from '@/db/schema';
import { createEmployee, setSchedule } from '../people';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});

const repair = readFileSync(path.resolve(import.meta.dirname, '../../../drizzle/0011_schedule_history.sql'), 'utf8');

describe('0011 puts schedule history back after 0010 (issue #3)', () => {
  it('past months keep 09:00–17:00; the 8h30 day starts as a new version on 1 October', async () => {
    const person = async (email: string) => {
      const r = await createEmployee(db, null, { email, nameEn: email });
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const [standard, custom, moved] = [await person('a@x.com'), await person('b@x.com'), await person('c@x.com')];
    // What 0010 left behind: standard schedules rewritten to 17:30 back to their start.
    await setSchedule(db, null, { employeeId: standard, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
    await setSchedule(db, null, { employeeId: custom, effectiveFrom: '2026-01-01', startTime: '10:00', endTime: '18:00' });
    // Someone who moved to a night shift in June: the old version is history only, nothing new from October.
    await setSchedule(db, null, { employeeId: moved, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:30' });
    await setSchedule(db, null, { employeeId: moved, effectiveFrom: '2026-06-01', startTime: '22:00', endTime: '06:00' });

    for (const statement of repair.split('--> statement-breakpoint')) await db.execute(sql.raw(statement));

    const rows = await db.select().from(schedules).orderBy(asc(schedules.effectiveFrom));
    const of = (id: string) => rows.filter((r) => r.employeeId === id).map((r) => `${r.effectiveFrom} ${r.startTime}–${r.endTime}`);
    expect(of(standard)).toEqual(['2026-01-01 09:00–17:00', '2026-10-01 09:00–17:30']);
    expect(of(custom)).toEqual(['2026-01-01 10:00–18:00']);
    expect(of(moved)).toEqual(['2026-01-01 09:00–17:00', '2026-06-01 22:00–06:00']);
  });
});
