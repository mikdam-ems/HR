import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '@/db';
import { assignments, clients, clockEvents, departments, employees } from '@/db/schema';
import { ammanInstant } from '@/lib/format';
import { monthClock } from '../clock';
import { createClient } from '../clients';
import { DEMO_CLIENT, DEMO_DOMAIN, DEMO_FORGOT_OUT, DEMO_ROSTER, ensureDemoData, nameFromEmail, seedBase } from '../seed';
import { createEmployee } from '../people';

const PEOPLE = DEMO_ROSTER.length; // 16

describe('demo data', () => {
  it('fills an empty database once, and only once', async () => {
    const db = await createDb('memory');
    await ensureDemoData(db);
    expect(PEOPLE).toBe(16);
    expect(await db.select().from(employees)).toHaveLength(PEOPLE);
    await Promise.all([ensureDemoData(db), ensureDemoData(db)]);
    expect(await db.select().from(employees)).toHaveLength(PEOPLE);
  });

  it('has one forgotten clock-out, two working days back, so the fix can be seen', async () => {
    const db = await createDb('memory');
    // Tuesday 29 September 2026: two Sunday–Thursday days back is Sunday the 27th.
    await ensureDemoData(db, ammanInstant('2026-09-29', '10:00'));
    const events = await db.select().from(clockEvents);
    expect(events).toHaveLength(1);
    const [fadi] = (await db.select().from(employees)).filter((e) => e.email === DEMO_FORGOT_OUT);
    expect(events[0]).toMatchObject({ employeeId: fadi!.id, kind: 'in' });
    const log = await monthClock(db, fadi!.id, 2026, 9);
    expect(Object.keys(log)).toEqual(['2026-09-27']);
    expect(log['2026-09-27']!.open).toBe(true);
  });

  it('builds the org: GM → delivery managers → teams, each manager heading their department', async () => {
    const db = await createDb('memory');
    await ensureDemoData(db);
    const people = await db.select().from(employees);
    const depts = await db.select().from(departments);
    const byEmail = (e: string) => people.find((p) => p.email === e)!;
    const dept = (n: string) => depts.find((d) => d.nameEn === n)!;

    const gm = byEmail(`huda.mansour@${DEMO_DOMAIN}`);
    expect(gm).toMatchObject({ nameEn: 'Huda Mansour', nameAr: 'هدى منصور', managerId: null });
    expect(gm.roles).toContain('admin');

    const reem = byEmail(`reem.haddad@${DEMO_DOMAIN}`);
    expect(reem.managerId).toBe(gm.id);
    expect(dept('QA').headId).toBe(reem.id);
    expect(byEmail(`omar.khalil@${DEMO_DOMAIN}`)).toMatchObject({ managerId: reem.id, departmentId: dept('QA').id });

    expect(dept('Software & Development').headId).toBe(byEmail(`tariq.hamdan@${DEMO_DOMAIN}`).id);
    expect(dept('Application Support').headId).toBe(byEmail(`khaled.yousef@${DEMO_DOMAIN}`).id);
    expect(people.filter((p) => p.departmentId === dept('Application Support').id)).toHaveLength(6);
    // Every demo person is made up, at the demo address, and the delivery teams work for the made-up client.
    expect(people.every((p) => p.email.endsWith(`@${DEMO_DOMAIN}`) && p.nameAr)).toBe(true);
    const [client] = await db.select().from(clients).where(eq(clients.nameEn, DEMO_CLIENT.nameEn));
    expect(client).toBeDefined();
    const placed = await db.select().from(assignments).where(eq(assignments.clientId, client!.id));
    expect(placed).toHaveLength(PEOPLE - 1); // everyone but the General Manager
  });

  it('only creates the EMS Internal client for a live site; client companies are added in the app', async () => {
    const db = await createDb('memory');
    await seedBase(db, () => {});
    expect((await db.select().from(clients)).map((c) => c.nameEn)).toEqual(['EMS Internal']);
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

describe('upgrading a demo that had real people (#29)', () => {
  it('drops everyone who is not a demo person and turns the old client into the demo client', async () => {
    const db = await createDb('memory');
    await seedBase(db, () => {});
    const [cal] = await db.select().from(clients);
    const old = await createClient(db, null, { nameEn: 'Jadwa Investment', calendarId: cal!.calendarId });
    if (!old.ok) throw new Error(old.error);
    const real = await createEmployee(db, null, { email: 'someone.real@ems-itech.com', nameEn: 'Someone Real' });
    if (!real.ok) throw new Error(real.error);

    await ensureDemoData(db);

    const people = await db.select().from(employees);
    expect(people).toHaveLength(PEOPLE);
    expect(people.some((p) => p.email === 'someone.real@ems-itech.com')).toBe(false);
    const names = (await db.select().from(clients)).map((c) => c.nameEn).sort();
    expect(names).toEqual(['Acme Investment', 'EMS Internal']);
    const [client] = await db.select().from(clients).where(eq(clients.id, old.value));
    expect(client).toMatchObject(DEMO_CLIENT);
  });
});

describe('nameFromEmail', () => {
  it('turns the address into a name', () => {
    expect(nameFromEmail('lina.farah@ems-itech.com')).toBe('Lina Farah');
    expect(nameFromEmail('Hani.Barakat@ems-itech.com')).toBe('Hani Barakat');
  });
});
