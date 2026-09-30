import { eq, like, notLike, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { calendars, clientShifts, clients, departments, employees } from '@/db/schema';
import { addDays, isWorkday, resolveDay } from '@/domain';
import { ammanInstant, todayISO } from '@/lib/format';
import { clock } from './clock';
import { createCalendar, createClient, setHoliday } from './clients';
import { createDepartment } from './departments';
import { addAssignment, createEmployee, putOnShift, setSchedule } from './people';
import { loadRulesContext } from './rulesContext';
import { getSettings, setSetting } from './settings';

/**
 * First-run data: calendars, the EMS Internal client, default settings, the first admin, and (for demos) a
 * made-up team placed with a made-up client. Real people and clients are added in the app, never from code. Used by `npm run db:seed` and by demo sites on their first request.
 *
 * Holidays are fixed-date ones only, as a starting point. Islamic holidays move every year
 * (moon sighting), so People & Culture adds them on the calendar page once announced.
 */

export function must<T>(r: { ok: true; value: T } | { ok: false; error: string; detail?: string }, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.error}${r.detail ? ` (${r.detail})` : ''}`);
  return r.value;
}

/** Calendars, the EMS Internal client and settings, if there are none yet. Client companies are added in the app. */
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
    await setSetting(db, 'homeCalendarId', jordan);
    await setSetting(db, 'overtimeRates', (await getSettings(db)).overtimeRates);
    log('✓ Calendars, the EMS Internal client and settings created.');
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
  nameAr: string;
  client: 'client' | 'internal';
  /** Heads this department. */
  heads?: DeptKey;
};

/** "maya.rahal@ems-itech.com" → "Maya Rahal". People & Culture can correct names later. */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]!
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** First day of the 8h30 full day (see drizzle/0011_schedule_history.sql). */
const FULL_DAY_830_FROM = '2026-10-01';
/** The client's working calendar in the demo: Saudi Arabia (Sun–Thu). */
function saudiCalendarId(cals: { id: string; name: string }[]): string | undefined {
  return cals.find((c) => c.name.startsWith('Saudi'))?.id;
}

/** Demo people's addresses: a subdomain no real mailbox uses, so the demo can never be mistaken for real staff. */
export const DEMO_DOMAIN = 'demo.ems-itech.com';
const demo = (user: string) => `${user}@${DEMO_DOMAIN}`;
const GM = demo('huda.mansour');
const QA_DM = demo('reem.haddad');
const DEV_DM = demo('tariq.hamdan');
const SUPPORT_DM = demo('khaled.yousef');

/** The made-up client the demo team is placed with. */
export const DEMO_CLIENT = {
  nameEn: 'Acme Investment',
  nameAr: 'أكمي للاستثمار',
  leaveContact: 'Your Acme project manager, by email',
};

/**
 * The demo team: made-up people in the shape of EMS (a General Manager, a delivery manager per delivery department,
 * and their teams). Managers are listed before their teams. Everyone on a delivery team works for the demo client.
 * Real staff are loaded with People → Import on the live site, never from code.
 */
export const DEMO_ROSTER: RosterPerson[] = [
  { email: GM, nameAr: 'هدى منصور', jobTitle: 'General Manager', dept: null, manager: null, roles: ['admin'], client: 'internal' },

  { email: QA_DM, nameAr: 'ريم حداد', jobTitle: 'Delivery Manager', dept: 'qa', manager: GM, client: 'client', heads: 'qa' },
  ...(
    [
      ['omar.khalil', 'عمر خليل'],
      ['yara.nasser', 'يارا ناصر'],
      ['karim.saeed', 'كريم سعيد'],
      ['lina.farah', 'لينا فرح'],
    ] as const
  ).map(([u, ar]) => ({ email: demo(u), nameAr: ar, jobTitle: 'QA Engineer', dept: 'qa' as const, manager: QA_DM, client: 'client' as const })),

  { email: DEV_DM, nameAr: 'طارق حمدان', jobTitle: 'Delivery Manager', dept: 'dev', manager: GM, client: 'client', heads: 'dev' },
  ...(
    [
      ['zaid.qasem', 'زيد قاسم'],
      ['nadia.salem', 'نادية سالم'],
    ] as const
  ).map(([u, ar]) => ({ email: demo(u), nameAr: ar, jobTitle: 'Software Engineer', dept: 'dev' as const, manager: DEV_DM, client: 'client' as const })),
  { email: demo('sami.darwish'), nameAr: 'سامي درويش', jobTitle: 'Senior UX/UI Designer', dept: 'dev', manager: DEV_DM, client: 'client' },

  { email: SUPPORT_DM, nameAr: 'خالد يوسف', jobTitle: 'Delivery Manager', dept: 'support', manager: GM, client: 'client', heads: 'support' },
  ...(
    [
      ['maya.rahal', 'مايا رحال'],
      ['nour.abbas', 'نور عباس'],
      ['hani.barakat', 'هاني بركات'],
      ['dana.khoury', 'دانة خوري'],
      ['fadi.jaber', 'فادي جابر'],
    ] as const
  ).map(([u, ar]) => ({ email: demo(u), nameAr: ar, jobTitle: 'Support Engineer', dept: 'support' as const, manager: SUPPORT_DM, client: 'client' as const })),
];

/**
 * Loads the demo team and the demo client. Safe to run again: existing people are updated, not duplicated.
 * Also drops the older sample people (…@example.com).
 */
export async function seedDemo(db: DB, log: (m: string) => void = console.log) {
  const deptIds = await seedDepartments(db, log);
  await db.delete(employees).where(like(employees.email, '%@example.com'));
  const all = await db.query.clients.findMany();
  const internal = all.find((c) => c.isInternal)!;
  const demoClient =
    all.find((c) => c.nameEn === DEMO_CLIENT.nameEn)?.id ??
    must(await createClient(db, null, { ...DEMO_CLIENT, calendarId: saudiCalendarId(await db.select().from(calendars)) ?? internal.calendarId }), 'client');
  const clientId = { client: demoClient, internal: internal.id };
  const idByEmail = new Map((await db.select().from(employees)).map((e) => [e.email, e.id]));
  let added = 0;

  for (const p of DEMO_ROSTER) {
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
      await createEmployee(db, null, { email: p.email, nameEn: nameFromEmail(p.email), nameAr: p.nameAr, ...fields, roles: p.roles ?? [] }),
      p.email,
    );
    idByEmail.set(p.email, e.id);
    must(await addAssignment(db, null, { employeeId: e.id, clientId: clientId[p.client], startDate: '2026-01-01' }), 'assign');
    // The full day became 8h30 from October 2026; earlier months keep the 8h day they were worked under.
    must(await setSchedule(db, null, { employeeId: e.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' }), 'schedule');
    const [standard] = await db.select().from(clientShifts).where(eq(clientShifts.clientId, clientId[p.client]));
    must(
      standard
        ? await putOnShift(db, null, e.id, standard.id, FULL_DAY_830_FROM)
        : await setSchedule(db, null, { employeeId: e.id, effectiveFrom: FULL_DAY_830_FROM, startTime: '09:00', endTime: '17:30' }),
      'schedule',
    );
    added++;
  }

  // Delivery managers head their departments; heads who no longer exist are cleared.
  const ids = new Set(idByEmail.values());
  for (const d of EMS_DEPARTMENTS) {
    const head = DEMO_ROSTER.find((p) => p.heads === d.key);
    const [row] = await db.select().from(departments).where(eq(departments.id, deptIds[d.key]));
    const headId = head ? idByEmail.get(head.email)! : row?.headId && ids.has(row.headId) ? row.headId : null;
    if (row && row.headId !== headId) await db.update(departments).set({ headId }).where(eq(departments.id, row.id));
  }
  log(added ? `✓ ${added} people added.` : '• People updated.');
}

/** Demo sites only: the person who forgot to clock out, so the missing clock-out can be seen and closed. */
export const DEMO_FORGOT_OUT = demo('fadi.jaber');

/**
 * Demo sites only: Fadi clocked in two working days ago and never clocked out. That day counts 0 hours and is
 * flagged until he enters when he left (issue #1), instead of the clock running on until now.
 */
export async function seedDemoClock(db: DB, now = new Date()) {
  const [person] = await db.select().from(employees).where(eq(employees.email, DEMO_FORGOT_OUT));
  if (!person) return;
  const ctx = await loadRulesContext(db);
  let date = todayISO(now);
  for (let back = 0; back < 2; ) {
    date = addDays(date, -1);
    if (isWorkday(resolveDay(ctx, person.id, date).dayType)) back++;
  }
  must(await clock(db, person.id, 'in', ammanInstant(date, '09:05'), 'web', 'office'), 'clock');
}

/**
 * Demo sites (DEMO_MODE=true) fill an empty database on first use, so hosts without a start
 * command (Vercel) need no manual seeding. A Postgres advisory lock stops two cold starts seeding twice.
 */
export async function ensureDemoData(db: DB, now = new Date()) {
  // Also upgrades an older demo (no departments, sample people, or real people from before #29).
  const ready = async (x: DB) =>
    (await x.select({ id: departments.id }).from(departments).limit(1)).length > 0 &&
    (await x.select({ id: employees.id }).from(employees).where(eq(employees.email, GM)).limit(1)).length > 0;
  if (await ready(db)) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(725001)`);
    if (await ready(tx as unknown as DB)) return;
    const quiet = () => {};
    // An older demo had EMS's real people and client (#29). Demo data is disposable: clear the people who aren't
    // demo people, and turn the old client into the demo client so its shifts and special hours stay valid.
    await tx.delete(employees).where(notLike(employees.email, `%@${DEMO_DOMAIN}`));
    await tx.update(clients).set(DEMO_CLIENT).where(eq(clients.nameEn, 'Jadwa Investment'));
    await seedAll(tx as unknown as DB, quiet);
    await seedDemo(tx as unknown as DB, quiet);
    await seedDemoClock(tx as unknown as DB, now);
  });
}
