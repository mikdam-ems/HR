import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { calendars, departments, employees } from '@/db/schema';
import { createCalendar, createClient, setHoliday } from './clients';
import { createDepartment, updateDepartment } from './departments';
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
    must(await createClient(db, null, { nameEn: 'EMS Internal', nameAr: 'EMS داخلي', calendarId: jordan }), 'client');
    must(await createClient(db, null, { nameEn: 'Jadwa Investment', nameAr: 'جدوى للاستثمار', calendarId: saudi }), 'client');
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
  { key: 'dev', nameEn: 'Software & Development', nameAr: 'تطوير البرمجيات' },
  { key: 'ux', nameEn: 'UX/UI', nameAr: 'تجربة وواجهة المستخدم' },
  { key: 'qa', nameEn: 'QA', nameAr: 'ضمان الجودة' },
  { key: 'support', nameEn: 'Application Support', nameAr: 'دعم التطبيقات' },
  { key: 'finance', nameEn: 'Finance', nameAr: 'المالية' },
  { key: 'pc', nameEn: 'People & Culture', nameAr: 'الأفراد والثقافة' },
] as const;
type DeptKey = (typeof EMS_DEPARTMENTS)[number]['key'];

/** Creates any missing departments (matched by English name) and returns their ids by key. */
export async function seedDepartments(db: DB, log: (m: string) => void = console.log) {
  const existing = await db.select().from(departments);
  const ids = {} as Record<DeptKey, string>;
  for (const d of EMS_DEPARTMENTS) {
    const found = existing.find((e) => e.nameEn.toLowerCase() === d.nameEn.toLowerCase());
    ids[d.key] = found ? found.id : must(await createDepartment(db, null, { nameEn: d.nameEn, nameAr: d.nameAr }), d.nameEn);
  }
  if (existing.length < EMS_DEPARTMENTS.length) log('✓ Departments ready.');
  return ids;
}

type DemoPerson = {
  email: string;
  nameEn: string;
  nameAr: string;
  jobTitle: string;
  dept: DeptKey | null;
  manager: string | null;
  roles?: ('hr' | 'admin' | 'finance')[];
  client: 'jadwa' | 'internal';
  shift?: { start: string; end: string; code: string };
};

/**
 * Sample organisation: a General Manager, a delivery manager per delivery department, their teams,
 * Finance and People & Culture. Safe to run again: existing sample people are updated, not duplicated.
 */
const DEMO_PEOPLE: DemoPerson[] = [
  { email: 'global@example.com', nameEn: 'Rami Haddad', nameAr: 'رامي حداد', jobTitle: 'General Manager', dept: null, manager: null, roles: ['admin'], client: 'internal' },
  { email: 'khaled@example.com', nameEn: 'Khaled Nasser', nameAr: 'خالد ناصر', jobTitle: 'Delivery Manager', dept: 'dev', manager: 'global@example.com', client: 'jadwa' },
  { email: 'hiba@example.com', nameEn: 'Hiba Mansour', nameAr: 'هبة منصور', jobTitle: 'Delivery Manager', dept: 'ux', manager: 'global@example.com', client: 'jadwa' },
  { email: 'tariq@example.com', nameEn: 'Tariq Zoubi', nameAr: 'طارق الزعبي', jobTitle: 'Delivery Manager', dept: 'qa', manager: 'global@example.com', client: 'jadwa' },
  { email: 'faris@example.com', nameEn: 'Faris Qasem', nameAr: 'فارس قاسم', jobTitle: 'Delivery Manager', dept: 'support', manager: 'global@example.com', client: 'jadwa' },
  { email: 'finance@example.com', nameEn: 'Nour Khalil', nameAr: 'نور خليل', jobTitle: 'Finance Officer', dept: 'finance', manager: 'global@example.com', roles: ['finance'], client: 'internal' },
  { email: 'hr@example.com', nameEn: 'Dana Saleh', nameAr: 'دانا صالح', jobTitle: 'People & Culture Lead', dept: 'pc', manager: 'global@example.com', roles: ['hr'], client: 'internal' },
  { email: 'rania@example.com', nameEn: 'Rania Saleh', nameAr: 'رانيا صالح', jobTitle: 'Software Engineer', dept: 'dev', manager: 'khaled@example.com', client: 'jadwa' },
  { email: 'yousef@example.com', nameEn: 'Yousef Barakat', nameAr: 'يوسف بركات', jobTitle: 'Backend Developer', dept: 'dev', manager: 'khaled@example.com', client: 'jadwa' },
  { email: 'maya@example.com', nameEn: 'Maya Haddad', nameAr: 'مايا حداد', jobTitle: 'UX/UI Designer', dept: 'ux', manager: 'hiba@example.com', client: 'jadwa' },
  { email: 'yazan@example.com', nameEn: 'Yazan Odeh', nameAr: 'يزن عودة', jobTitle: 'QA Engineer', dept: 'qa', manager: 'tariq@example.com', client: 'jadwa' },
  { email: 'lina@example.com', nameEn: 'Lina Khoury', nameAr: 'لينا خوري', jobTitle: 'Support Engineer', dept: 'support', manager: 'faris@example.com', client: 'jadwa' },
  { email: 'omar@example.com', nameEn: 'Omar Haddad', nameAr: 'عمر حداد', jobTitle: 'Support Engineer', dept: 'support', manager: 'faris@example.com', client: 'jadwa', shift: { start: '12:00', end: '20:00', code: 'B' } },
];

export async function seedDemo(db: DB, log: (m: string) => void = console.log) {
  const deptIds = await seedDepartments(db, log);
  const clients = await db.query.clients.findMany();
  const clientId = { jadwa: clients.find((c) => c.nameEn === 'Jadwa Investment')!.id, internal: clients.find((c) => c.nameEn === 'EMS Internal')!.id };
  const idByEmail = new Map((await db.select().from(employees)).map((e) => [e.email, e.id]));
  let added = 0;

  // Managers are listed before their teams, so each manager exists by the time it's referenced.
  for (const p of DEMO_PEOPLE) {
    const fields = {
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      jobTitle: p.jobTitle,
      departmentId: p.dept ? deptIds[p.dept] : null,
      managerId: p.manager ? (idByEmail.get(p.manager) ?? null) : null,
    };
    const existingId = idByEmail.get(p.email);
    if (existingId) {
      await db.update(employees).set(fields).where(eq(employees.id, existingId));
      continue;
    }
    const e = must(await createEmployee(db, null, { email: p.email, ...fields, roles: p.roles ?? [], hireDate: '2022-03-01' }), p.email);
    idByEmail.set(p.email, e.id);
    must(await addAssignment(db, null, { employeeId: e.id, clientId: clientId[p.client], startDate: '2026-01-01' }), 'assign');
    must(
      await setSchedule(db, null, {
        employeeId: e.id,
        effectiveFrom: '2026-01-01',
        startTime: p.shift?.start ?? '09:00',
        endTime: p.shift?.end ?? '17:00',
        shiftCode: p.shift?.code ?? null,
      }),
      'schedule',
    );
    added++;
  }

  // Delivery managers head their departments.
  for (const p of DEMO_PEOPLE.filter((x) => x.jobTitle === 'Delivery Manager' || x.roles?.some((r) => r !== 'admin'))) {
    if (!p.dept) continue;
    const d = EMS_DEPARTMENTS.find((x) => x.key === p.dept)!;
    await updateDepartment(db, null, deptIds[p.dept], { nameEn: d.nameEn, nameAr: d.nameAr, headId: idByEmail.get(p.email)! });
  }
  log(added ? `✓ ${added} demo people added (sign in with AUTH_DEV_LOGIN=true).` : '• Demo people updated.');
}

/**
 * Demo sites (DEMO_MODE=true) fill an empty database on first use, so hosts without a start
 * command (Vercel) need no manual seeding. A Postgres advisory lock stops two cold starts seeding twice.
 */
export async function ensureDemoData(db: DB) {
  // Also upgrades an older demo that predates departments.
  const ready = async (x: DB) =>
    (await x.select({ id: departments.id }).from(departments).limit(1)).length > 0 &&
    (await x.select({ id: employees.id }).from(employees).limit(1)).length > 0;
  if (await ready(db)) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(725001)`);
    if (await ready(tx as unknown as DB)) return;
    const quiet = () => {};
    await seedAll(tx as unknown as DB, quiet);
    await seedDemo(tx as unknown as DB, quiet);
  });
}
