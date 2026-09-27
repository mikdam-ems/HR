import { describe, expect, it } from 'vitest';
import { createDb } from '@/db';
import { departments, employees } from '@/db/schema';
import { EMS_ROSTER, ensureDemoData, nameFromEmail, seedBase } from '../seed';
import { createEmployee } from '../people';

const PEOPLE = EMS_ROSTER.length; // 16

describe('demo data', () => {
  it('fills an empty database once, and only once', async () => {
    const db = await createDb('memory');
    await ensureDemoData(db);
    expect(PEOPLE).toBe(16);
    expect(await db.select().from(employees)).toHaveLength(PEOPLE);
    await Promise.all([ensureDemoData(db), ensureDemoData(db)]);
    expect(await db.select().from(employees)).toHaveLength(PEOPLE);
  });

  it('builds the org: GM → delivery managers → teams, each manager heading their department', async () => {
    const db = await createDb('memory');
    await ensureDemoData(db);
    const people = await db.select().from(employees);
    const depts = await db.select().from(departments);
    const byEmail = (e: string) => people.find((p) => p.email === e)!;
    const dept = (n: string) => depts.find((d) => d.nameEn === n)!;

    const gm = byEmail('suma.abdullah@ems-itech.com');
    expect(gm).toMatchObject({ nameEn: 'Suma Abdullah', managerId: null });
    expect(gm.roles).toContain('admin');

    const dania = byEmail('dania.alrashed@ems-itech.com');
    expect(dania.managerId).toBe(gm.id);
    expect(dept('QA').headId).toBe(dania.id);
    expect(byEmail('moath.alhamshari@ems-itech.com')).toMatchObject({ managerId: dania.id, departmentId: dept('QA').id });

    expect(dept('Software & Development').headId).toBe(byEmail('faisal.abuzaid@ems-itech.com').id);
    expect(dept('Application Support').headId).toBe(byEmail('anas.ahmad@ems-itech.com').id);
    expect(people.filter((p) => p.departmentId === dept('Application Support').id)).toHaveLength(6);
  });
});

describe('upgrading an older demo', () => {
  it('replaces the made-up sample people and clears their department heads', async () => {
    const db = await createDb('memory');
    await seedBase(db, () => {});
    const old = await createEmployee(db, null, { email: 'hiba@example.com', nameEn: 'Hiba' });
    if (!old.ok) throw new Error(old.error);
    await db.insert(departments).values({ nameEn: 'UX/UI', headId: old.value.id });

    await ensureDemoData(db);

    const people = await db.select().from(employees);
    expect(people).toHaveLength(PEOPLE);
    expect(people.some((p) => p.email.endsWith('@example.com'))).toBe(false);
    const depts = await db.select().from(departments);
    expect(depts).toHaveLength(6);
    expect(depts.find((d) => d.nameEn === 'UX/UI')!.headId).toBeNull();
  });
});

describe('nameFromEmail', () => {
  it('turns the address into a name', () => {
    expect(nameFromEmail('jazzaa.almohameed@ems-itech.com')).toBe('Jazzaa Almohameed');
    expect(nameFromEmail('Saleh.Ahmad@ems-itech.com')).toBe('Saleh Ahmad');
  });
});
