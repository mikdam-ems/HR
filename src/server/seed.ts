import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { calendars, employees } from '@/db/schema';
import { createCalendar, createClient, setHoliday } from './clients';
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

export async function seedDemo(db: DB, log: (m: string) => void = console.log) {
  if ((await db.select().from(employees).where(eq(employees.email, 'khaled@example.com'))).length) {
    log('• Demo people already exist — skipped.');
    return;
  }
  const clients = await db.query.clients.findMany();
  const jadwa = clients.find((c) => c.nameEn === 'Jadwa Investment')!.id;
  const internal = clients.find((c) => c.nameEn === 'EMS Internal')!.id;

  const add = async (email: string, nameEn: string, nameAr: string, jobTitle: string, managerId: string | null, roles: ('hr' | 'admin' | 'finance')[] = []) =>
    must(await createEmployee(db, null, { email, nameEn, nameAr, jobTitle, managerId, roles, hireDate: '2022-03-01' }), email);

  const global = await add('global@example.com', 'Rami Haddad', 'رامي حداد', 'Global Manager', null, ['admin']);
  const khaled = await add('khaled@example.com', 'Khaled Nasser', 'خالد ناصر', 'Technical Manager', global.id);
  const hr = await add('hr@example.com', 'Dana Saleh', 'دانا صالح', 'People & Culture', global.id, ['hr']);
  const finance = await add('finance@example.com', 'Nour Khalil', 'نور خليل', 'Finance', global.id, ['finance']);
  const lina = await add('lina@example.com', 'Lina Khoury', 'لينا خوري', 'Support Engineer', khaled.id);
  const omar = await add('omar@example.com', 'Omar Haddad', 'عمر حداد', 'Support Engineer', khaled.id);
  const rania = await add('rania@example.com', 'Rania Saleh', 'رانيا صالح', 'Software Engineer', khaled.id);

  for (const p of [khaled, lina, omar, rania]) {
    must(await addAssignment(db, null, { employeeId: p.id, clientId: jadwa, startDate: '2026-01-01' }), 'assign');
  }
  for (const p of [global, hr, finance]) {
    must(await addAssignment(db, null, { employeeId: p.id, clientId: internal, startDate: '2026-01-01' }), 'assign');
  }
  for (const p of [global, khaled, hr, finance, lina, rania]) {
    must(await setSchedule(db, null, { employeeId: p.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' }), 'schedule');
  }
  must(
    await setSchedule(db, null, { employeeId: omar.id, effectiveFrom: '2026-01-01', startTime: '12:00', endTime: '20:00', shiftCode: 'B' }),
    'schedule',
  );
  log('✓ Demo people added (sign in with AUTH_DEV_LOGIN=true).');
}


/**
 * Demo sites (DEMO_MODE=true) fill an empty database on first use, so hosts without a start
 * command (Vercel) need no manual seeding. A Postgres advisory lock stops two cold starts seeding twice.
 */
export async function ensureDemoData(db: DB) {
  if ((await db.select({ id: employees.id }).from(employees).limit(1)).length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(725001)`);
    if ((await tx.select({ id: employees.id }).from(employees).limit(1)).length) return;
    const quiet = () => {};
    await seedBase(tx as unknown as DB, quiet);
    await seedDemo(tx as unknown as DB, quiet);
  });
}
