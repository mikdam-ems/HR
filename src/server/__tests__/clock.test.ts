import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { msToMinutes } from '@/domain';
import { ammanInstant } from '@/lib/format';
import { clock, clockOutAt, clockView, monthClock, teamClock } from '../clock';
import { createEmployee } from '../people';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, clock_events, employees CASCADE`);
});

const t = (local: string) => ammanInstant(local.slice(0, 10), local.slice(11, 16));

async function me() {
  const r = await createEmployee(db, null, { email: 'moath@ems.com', nameEn: 'Moath' });
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

describe('clocking', () => {
  it('in → break → back → out, with a live total in between', async () => {
    const id = await me();
    expect((await clock(db, id, 'in', t('2026-09-28 09:05'))).ok).toBe(true);
    expect(await clock(db, id, 'in', t('2026-09-28 09:06'))).toMatchObject({ error: 'clock_invalid' });
    await clock(db, id, 'break_start', t('2026-09-28 13:00'));
    await clock(db, id, 'break_end', t('2026-09-28 13:30'));

    const mid = await clockView(db, id, t('2026-09-28 15:00'));
    expect(mid.state).toBe('working');
    expect(msToMinutes(mid.today.workedMs)).toBe(3 * 60 + 55 + 90);
    expect(msToMinutes(mid.today.breakMs)).toBe(30);

    await clock(db, id, 'out', t('2026-09-28 18:00'));
    const month = await monthClock(db, id, 2026, 9, t('2026-09-28 20:00'));
    expect(msToMinutes(month['2026-09-28']!.workedMs)).toBe(8 * 60 + 25);
    expect(month['2026-09-28']!.open).toBe(false);
    expect((await teamClock(db, [id]))[id]!.state).toBe('out');
  });

  it('a forgotten clock-out is closed with the real leaving time before clocking in again', async () => {
    const id = await me();
    await clock(db, id, 'in', t('2026-09-27 09:00'));
    const next = await clockView(db, id, t('2026-09-28 08:55'));
    expect(next.openFrom).toMatchObject({ date: '2026-09-27' });
    expect(await clock(db, id, 'break_start', t('2026-09-28 08:56'))).toMatchObject({ error: 'clock_invalid' });

    expect(await clockOutAt(db, id, '2026-09-27', '08:00', t('2026-09-28 09:00'))).toMatchObject({ error: 'clock_invalid' });
    expect((await clockOutAt(db, id, '2026-09-27', '17:30', t('2026-09-28 09:00'))).ok).toBe(true);
    expect((await clock(db, id, 'in', t('2026-09-28 09:01'))).ok).toBe(true);

    const month = await monthClock(db, id, 2026, 9, t('2026-09-28 12:00'));
    expect(msToMinutes(month['2026-09-27']!.workedMs)).toBe(8 * 60 + 30);
    expect(month['2026-09-28']!.open).toBe(true);
  });
});
