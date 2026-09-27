import { eq, like, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { calendars, departments, employees } from '@/db/schema';
import { createCalendar, createClient, setHoliday } from './clients';
import { createDepartment } from './departments';
import { addAssignment, createEmployee, setSchedule } from './people';
import { getSettings, setSetting } from './settings';

/**
 * First-run data: calendars, the EMS Internal and Jadwa clients, default settings, the first admin,
 * and (for demos) sample people. Used by `npm run db:seed` and by demo sites on their first request.
 *
 * Holidays are fixed-date ones only, as a starting point. Islamic holidays move every year
 * (moon sighting), so People & Culture adds them on the calendar page once announced.
 */

export function must<T>(r: { ok: true; value: T } | { ok: false; error: string; detail?: string }, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.error}${r.detail ? ` (${r.detail})` : ''}`);
  return r.value;
}

/** Calendars, clients and settings, if there are none yet. */
export async function seedBase(db: DB, log: (m: string) => void = console.log) {
  if ((await db.select().from(calendars)).length === 0) {
    const jordan = must(await createCalendar(db, null, { name: 'Jordan — EMS home (Sun–Thu)', workWeek: [0, 1, 2, 3, 4] }), 'jordan');
    const saudi = must(await createCalendar(db, null, { name: 'Saudi Arabia (Sun–Thu)', workWeek: [0, 1, 2, 3, 4] }), 'saudi');
    const year = new Date().getUTCFullYear();
    for (const y of [year, year + 1]) {
      for (const [md, en, ar] of [
        ['01-01', "New Year's Day", 'رأس السنة الميلادية'],
        ['05-01', 'Labour Day', 'عيد العمال'],
        ['05-25', 'Independence Day', 'عيد الاستقلال'],
        ['12-25', 'Christmas Day', 'عيد الميلاد المجيد'],
      ] as const) {
        must(await setHoliday(db, null, { calendarId: jordan, date: `${y}-${md}`, nameEn: en, nameAr: ar }), 'holiday');
      }
      for (const [md, en, ar] of [
        ['02-22', 'Founding Day', 'يوم التأسيس'],
        ['09-23', 'Saudi National Day', 'اليوم الوطني السعودي'],
      ] as const) {
        must(await setHoliday(db, null, { calendarId: saudi, date: `${y}-${md}`, nameEn: en, nameAr: ar }), 'holiday');
      }
    }
    must(await createClient(db, null, { nameEn: 'EMS Internal', nameAr: 'EMS داخلي', calendarId: jordan, isInternal: true }), 'client');
    must(
      await createClient(db, null, {
        nameEn: 'Jadwa Investment',
        nameAr: 'جدوى للاستثمار',
        calendarId: saudi,
        leaveContact: 'Your Jadwa project manager, by email',
      }),
      'client',
    );
    await setSetting(db, 'homeCalendarId', jordan);
    await setSetting(db, 'overtimeRates', (await getSettings(db)).overtimeRates);
    log('✓ Calendars, clients and settings created.');
  } else {
    log('• Calendars already exist — skipped.');
  }

}

/** Base data for a fresh install: calendars, clients, settings and EMS's departments. */
export async function seedAll(db: DB, log: (m: string) => void = console.log) {
  await seedBase(db, log);
  await seedDepartments(db, log);
}

/** Makes this email an admin, creating the person if needed. */
export async function ensureAdmin(db: DB, email: string | undefined, log: (m: string) => void = console.log) {
  const adminEmail = email?.trim().toLowerCase();
  if (adminEmail) {
    const [existing] = await db.select().from(employees).where(eq(employees.email, adminEmail));
    if (existing) {
      await db
        .update(employees)
        .set({ roles: Array.from(new Set([...existing.roles, 'admin' as const])) })
        .where(eq(employees.id, existing.id));
      log(`• ${adminEmail} already exists — made admin.`);
    } else {
      must(
        await createEmployee(db, null, { email: adminEmail, nameEn: adminEmail.split('@')[0]!, roles: ['admin', 'hr'] }),
        'admin',
      );
      log(`✓ Admin ${adminEmail} created. Sign in with that Google account.`);
    }
  }

}

/** EMS's departments: four delivery teams plus Finance and People & Culture. */
export const EMS_DEPARTMENTS = [
  { key: 'dev', nameEn: 'Software & Development', nameAr: 'تطوير البرمجيات', description: 'Designs, builds and ships the software our clients run their business on.' },
  { key: 'ux', nameEn: 'UX/UI', nameAr: 'تجربة وواجهة المستخدم', description: 'Research, user experience and interface design across client products.' },
  { key: 'qa', nameEn: 'QA', nameAr: 'ضمان الجودة', description: 'Quality assurance and automated testing, so every release is stable.' },
  { key: 'support', nameEn: 'Application Support', nameAr: 'دعم التطبيقات', description: '24/7 production support and incident management for client systems.' },
  { key: 'finance', nameEn: 'Finance', nameAr: 'المالية', description: 'Payroll, invoicing and month-end checks of timesheets.' },
  { key: 'pc', nameEn: 'People & Culture', nameAr: 'الأفراد والثقافة', description: 'Hiring, onboarding, leave and everything that makes EMS a good place to work.' },
] as const;
type DeptKey = (typeof EMS_DEPARTMENTS)[number]['key'];

/** Creates any missing departments (matched by English name) and returns their ids by key. */
export async function seedDepartments(db: DB, log: (m: string) => void = console.log) {
  const existing = await db.select().from(departments);
  const ids = {} as Record<DeptKey, string>;
  for (const d of EMS_DEPARTMENTS) {
    const found = existing.find((e) => e.nameEn.toLowerCase() === d.nameEn.toLowerCase());
    ids[d.key] = found
      ? found.id
      : must(await createDepartment(db, null, { nameEn: d.nameEn, nameAr: d.nameAr, description: d.description }), d.nameEn);
    if (found && !found.description) await db.update(departments).set({ description: d.description }).where(eq(departments.id, found.id));
  }
  if (existing.length < EMS_DEPARTMENTS.length) log('✓ Departments ready.');
  return ids;
}

type RosterPerson = {
  email: string;
  jobTitle: string;
  dept: DeptKey | null;
  manager: string | null;
  roles?: ('hr' | 'admin' | 'finance')[];
  client: 'jadwa' | 'internal';
  /** Heads this department. */
  heads?: DeptKey;
};

/** "moath.alhamshari@ems-itech.com" → "Moath Alhamshari". People & Culture can correct names later. */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]!
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const GM = 'suma.abdullah@ems-itech.com';
const QA_DM = 'dania.alrashed@ems-itech.com';
const DEV_DM = 'faisal.abuzaid@ems-itech.com';
const SUPPORT_DM = 'anas.ahmad@ems-itech.com';

/**
 * EMS's people: the General Manager, a delivery manager per delivery department, and their teams.
 * Managers are listed before their teams. Everyone on a delivery team works for Jadwa Investment.
 */
export const EMS_ROSTER: RosterPerson[] = [
  { email: GM, jobTitle: 'General Manager', dept: null, manager: null, roles: ['admin'], client: 'internal' },

  { email: QA_DM, jobTitle: 'Delivery Manager', dept: 'qa', manager: GM, client: 'jadwa', heads: 'qa' },
  ...['abdullah.alhajjaj', 'moath.alhamshari', 'sheraz.hasan', 'jazzaa.almohameed'].map((u) => ({
    email: `${u}@ems-itech.com`, jobTitle: 'QA Engineer', dept: 'qa' as const, manager: QA_DM, client: 'jadwa' as const,
  })),

  { email: DEV_DM, jobTitle: 'Delivery Manager', dept: 'dev', manager: GM, client: 'jadwa', heads: 'dev' },
  ...['laith.alnajjar', 'mohammad.alghzawi'].map((u) => ({
    email: `${u}@ems-itech.com`, jobTitle: 'Software Engineer', dept: 'dev' as const, manager: DEV_DM, client: 'jadwa' as const,
  })),
  { email: 'mikdam.qandil@ems-itech.com', jobTitle: 'Senior UX/UI Designer', dept: 'dev', manager: DEV_DM, client: 'jadwa' },

  { email: SUPPORT_DM, jobTitle: 'Delivery Manager', dept: 'support', manager: GM, client: 'jadwa', heads: 'support' },
  ...['rama.shararah', 'alksandra.aljabery', 'ahmad.alheresh', 'ashjan.iqilan', 'saleh.ahmad'].map((u) => ({
    email: `${u}@ems-itech.com`, jobTitle: 'Support Engineer', dept: 'support' as const, manager: SUPPORT_DM, client: 'jadwa' as const,
  })),
];

/**
 * Loads EMS's people. Safe to run again: existing people are updated, not duplicated.
 * Demo sites also drop the old made-up sample people (…@example.com).
 */
export async function seedDemo(db: DB, log: (m: string) => void = console.log) {
  const deptIds = await seedDepartments(db, log);
  await db.delete(employees).where(like(employees.email, '%@example.com'));
  const clients = await db.query.clients.findMany();
  const clientId = { jadwa: clients.find((c) => c.nameEn === 'Jadwa Investment')!.id, internal: clients.find((c) => c.nameEn === 'EMS Internal')!.id };
  const idByEmail = new Map((await db.select().from(employees)).map((e) => [e.email, e.id]));
  let added = 0;

  for (const p of EMS_ROSTER) {
    const fields = {
      jobTitle: p.jobTitle,
      departmentId: p.dept ? deptIds[p.dept] : null,
      managerId: p.manager ? (idByEmail.get(p.manager) ?? null) : null,
    };
    const existingId = idByEmail.get(p.email);
    if (existingId) {
      await db.update(employees).set(fields).where(eq(employees.id, existingId));
      continue;
    }
    const e = must(
      await createEmployee(db, null, { email: p.email, nameEn: nameFromEmail(p.email), ...fields, roles: p.roles ?? [] }),
      p.email,
    );
    idByEmail.set(p.email, e.id);
    must(await addAssignment(db, null, { employeeId: e.id, clientId: clientId[p.client], startDate: '2026-01-01' }), 'assign');
    must(await setSchedule(db, null, { employeeId: e.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' }), 'schedule');
    added++;
  }

  // Delivery managers head their departments; heads who no longer exist are cleared.
  const ids = new Set(idByEmail.values());
  for (const d of EMS_DEPARTMENTS) {
    const head = EMS_ROSTER.find((p) => p.heads === d.key);
    const [row] = await db.select().from(departments).where(eq(departments.id, deptIds[d.key]));
    const headId = head ? idByEmail.get(head.email)! : row?.headId && ids.has(row.headId) ? row.headId : null;
    if (row && row.headId !== headId) await db.update(departments).set({ headId }).where(eq(departments.id, row.id));
  }
  log(added ? `✓ ${added} people added.` : '• People updated.');
}

/**
 * Demo sites (DEMO_MODE=true) fill an empty database on first use, so hosts without a start
 * command (Vercel) need no manual seeding. A Postgres advisory lock stops two cold starts seeding twice.
 */
export async function ensureDemoData(db: DB) {
  // Also upgrades an older demo (no departments, or the made-up sample people).
  const ready = async (x: DB) =>
    (await x.select({ id: departments.id }).from(departments).limit(1)).length > 0 &&
    (await x.select({ id: employees.id }).from(employees).where(eq(employees.email, GM)).limit(1)).length > 0;
  if (await ready(db)) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(725001)`);
    if (await ready(tx as unknown as DB)) return;
    const quiet = () => {};
    await seedAll(tx as unknown as DB, quiet);
    await seedDemo(tx as unknown as DB, quiet);
  });
}
