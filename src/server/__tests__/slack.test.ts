import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { employees } from '@/db/schema';
import { ammanInstant } from '@/lib/format';
import { createEmployee } from '../people';
import { employeeForSlackUser, parseCommand, runSlackCommand, verifySlackSignature } from '../slack';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, clock_events, employees CASCADE`);
});

const t = (local: string) => ammanInstant(local.slice(0, 10), local.slice(11, 16));

describe('slack signature', () => {
  const secret = 'shhh';
  const body = 'command=%2Fems&text=in&user_id=U1';
  const sign = (ts: string) => `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;

  it('accepts a fresh, correctly signed request only', () => {
    expect(verifySlackSignature(secret, '1000', sign('1000'), body, 1010)).toBe(true);
    expect(verifySlackSignature(secret, '1000', sign('1000'), body + 'x', 1010)).toBe(false);
    expect(verifySlackSignature('other', '1000', sign('1000'), body, 1010)).toBe(false);
    expect(verifySlackSignature(secret, '1000', sign('1000'), body, 1000 + 60 * 6)).toBe(false);
    expect(verifySlackSignature(secret, null, null, body, 1010)).toBe(false);
  });
});

describe('slack commands', () => {
  it('understands /ems words and direct commands', () => {
    expect(parseCommand('/ems', 'in')).toBe('in');
    expect(parseCommand('/ems', 'Break')).toBe('break_start');
    expect(parseCommand('/ems', 'back')).toBe('break_end');
    expect(parseCommand('/ems', '')).toBe('status');
    expect(parseCommand('/ems', 'dance')).toBe('help');
    expect(parseCommand('/out', '')).toBe('out');
  });

  it('matches the Slack user by email once, then remembers them', async () => {
    const r = await createEmployee(db, null, { email: 'sheraz@ems.com', nameEn: 'Sheraz' });
    if (!r.ok) throw new Error(r.error);
    let lookups = 0;
    const lookup = async () => {
      lookups++;
      return 'Sheraz@EMS.com';
    };
    expect((await employeeForSlackUser(db, 'U1', lookup))?.id).toBe(r.value.id);
    expect((await employeeForSlackUser(db, 'U1', lookup))?.id).toBe(r.value.id);
    expect(lookups).toBe(1);
    expect((await db.select().from(employees).where(eq(employees.id, r.value.id)))[0]!.slackUserId).toBe('U1');
    expect(await employeeForSlackUser(db, 'U2', async () => 'stranger@gmail.com')).toBeNull();
  });

  it('clocks in, breaks, comes back and clocks out with friendly replies', async () => {
    const r = await createEmployee(db, null, { email: 'sheraz@ems.com', nameEn: 'Sheraz' });
    if (!r.ok) throw new Error(r.error);
    const id = r.value.id;
    expect(await runSlackCommand(db, id, 'status', t('2026-09-28 08:00'))).toContain('Not clocked in');
    expect(await runSlackCommand(db, id, 'in', t('2026-09-28 09:00'))).toContain('Clocked in at 09:00');
    expect(await runSlackCommand(db, id, 'in', t('2026-09-28 09:30'))).toContain('already clocked in');
    expect(await runSlackCommand(db, id, 'break_start', t('2026-09-28 13:00'))).toContain('4h worked so far');
    expect(await runSlackCommand(db, id, 'in', t('2026-09-28 13:30'))).toContain('Back at 13:30');
    expect(await runSlackCommand(db, id, 'out', t('2026-09-28 17:30'))).toContain('8h today (breaks 30m)');
    expect(await runSlackCommand(db, id, 'out', t('2026-09-28 17:31'))).toContain('not clocked in');
  });
});
