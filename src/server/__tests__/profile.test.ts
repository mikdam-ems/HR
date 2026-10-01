import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { employees } from '@/db/schema';
import { createEmployee } from '../people';
import { currentStatus, getPhoto, setPhoto, setStatus, updateOwnProfile } from '../profile';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, employees CASCADE`);
});

async function me() {
  const r = await createEmployee(db, null, { email: 'maya@ems.com', nameEn: 'Maya', jobTitle: 'Designer' });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('own profile', () => {
  it('updates the bio, but never the name, title or roles', async () => {
    const p = await me();
    const r = await updateOwnProfile(db, p.id, { nameEn: 'Someone Else', jobTitle: 'CEO', bio: 'Loves type.', roles: ['admin'] } as never);
    expect(r.ok).toBe(true);
    const [after] = await db.select().from(employees).where(eq(employees.id, p.id));
    expect(after).toMatchObject({ nameEn: 'Maya', jobTitle: 'Designer', bio: 'Loves type.', email: 'maya@ems.com' });
    expect(after!.roles).toEqual(['employee']);
  });

  it('stores a small image photo and removes it', async () => {
    const p = await me();
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect((await setPhoto(db, p.id, png)).ok).toBe(true);
    expect(await getPhoto(db, p.id)).toBe(png);
    expect((await db.select().from(employees).where(eq(employees.id, p.id)))[0]!.photoUpdatedAt).not.toBeNull();
    expect(await setPhoto(db, p.id, 'data:text/html;base64,PHNjcmlwdD4=')).toMatchObject({ error: 'invalid_input' });
    expect((await setPhoto(db, p.id, null)).ok).toBe(true);
    expect(await getPhoto(db, p.id)).toBeNull();
  });

  it('a status lasts for the day it was set', async () => {
    const p = await me();
    await setStatus(db, p.id, { emoji: '💻', text: 'Deep in the release' }, '2026-09-27');
    const [row] = await db.select().from(employees).where(eq(employees.id, p.id));
    expect(currentStatus(row!, '2026-09-27')).toEqual({ emoji: '💻', text: 'Deep in the release', until: '2026-09-27' });
    expect(currentStatus(row!, '2026-09-28')).toBeNull();
    await setStatus(db, p.id, null);
    const [cleared] = await db.select().from(employees).where(eq(employees.id, p.id));
    expect(currentStatus(cleared!, '2026-09-27')).toBeNull();
  });

  it('a status can last the week (through Saturday) or until it is cleared', async () => {
    const p = await me();
    // 2026-10-01 is a Thursday.
    await setStatus(db, p.id, { emoji: '🏠', text: 'On leave until Sunday', duration: 'week' }, '2026-10-01');
    let [row] = await db.select().from(employees).where(eq(employees.id, p.id));
    expect(currentStatus(row!, '2026-10-03')?.until).toBe('2026-10-03');
    expect(currentStatus(row!, '2026-10-04')).toBeNull();

    await setStatus(db, p.id, { emoji: '🤝', duration: 'until_cleared' }, '2026-10-01');
    [row] = await db.select().from(employees).where(eq(employees.id, p.id));
    expect(currentStatus(row!, '2027-01-01')).toEqual({ emoji: '🤝', text: null, until: null });
  });
});
