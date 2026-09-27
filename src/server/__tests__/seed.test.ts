import { describe, expect, it } from 'vitest';
import { createDb } from '@/db';
import { employees } from '@/db/schema';
import { ensureDemoData } from '../seed';

describe('demo data', () => {
  it('fills an empty database once, and only once', async () => {
    const db = await createDb('memory');
    await ensureDemoData(db);
    const first = await db.select().from(employees);
    expect(first.length).toBe(7);
    await Promise.all([ensureDemoData(db), ensureDemoData(db)]);
    expect((await db.select().from(employees)).length).toBe(7);
  });
});
