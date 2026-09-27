import { describe, expect, it } from 'vitest';
import { createDb } from '@/db';
import { employees } from '@/db/schema';
import { ensureDemoData } from '../seed';

describe('demo data', () => {
  it('fills an empty database once, and only once', async () => {
    const db = await createDb('memory');
    await ensureDemoData(db);
    const first = await db.select().from(employees);
    expect(first.length).toBe(13);
    await Promise.all([ensureDemoData(db), ensureDemoData(db)]);
    expect((await db.select().from(employees)).length).toBe(13);
  });
});

describe('upgrading an older demo', () => {
  it('adds departments and new people, and moves existing people, without duplicates', async () => {
    const { seedBase } = await import('../seed');
    const { createEmployee } = await import('../people');
    const { departments } = await import('@/db/schema');
    const db = await createDb('memory');
    await seedBase(db, () => {});
    const boss = await createEmployee(db, null, { email: 'global@example.com', nameEn: 'Rami' });
    if (!boss.ok) throw new Error(boss.error);
    await createEmployee(db, null, { email: 'lina@example.com', nameEn: 'Lina', managerId: boss.value.id });

    await ensureDemoData(db);

    const people = await db.select().from(employees);
    expect(people).toHaveLength(13);
    const depts = await db.select().from(departments);
    expect(depts.map((d) => d.nameEn).sort()).toEqual(
      ['Application Support', 'Finance', 'People & Culture', 'QA', 'Software & Development', 'UX/UI'].sort(),
    );
    const lina = people.find((p) => p.email === 'lina@example.com')!;
    const faris = people.find((p) => p.email === 'faris@example.com')!;
    expect(lina.managerId).toBe(faris.id);
    expect(lina.departmentId).toBe(depts.find((d) => d.nameEn === 'Application Support')!.id);
    expect(depts.find((d) => d.nameEn === 'Application Support')!.headId).toBe(faris.id);
  });
});
