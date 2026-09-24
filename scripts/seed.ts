/**
 * First-run setup: calendars, the EMS Internal and Jadwa clients, default settings and the first admin.
 *   SEED_ADMIN_EMAIL=you@ems-itech.com npm run db:seed
 *   npm run db:seed -- --demo      also adds sample people (for local development only)
 *
 * Holidays below are fixed-date ones only, as a starting point. Islamic holidays move every year
 * (moon sighting), so People & Culture adds them on the calendar page once announced.
 */
import { eq } from 'drizzle-orm';
import { createDb } from '@/db';
import { calendars, employees } from '@/db/schema';
import { createCalendar, createClient, setHoliday } from '@/server/clients';
import { addAssignment, createEmployee, setSchedule } from '@/server/people';
import { getSettings, setSetting } from '@/server/settings';

const demo = process.argv.includes('--demo');

function must<T>(r: { ok: true; value: T } | { ok: false; error: string; detail?: string }, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.error}${r.detail ? ` (${r.detail})` : ''}`);
  return r.value;
}

async function main() {
  const db = await createDb();

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
    console.log('✓ Calendars, clients and settings created.');
  } else {
    console.log('• Calendars already exist — skipped.');
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    const [existing] = await db.select().from(employees).where(eq(employees.email, adminEmail));
    if (existing) {
      await db
        .update(employees)
        .set({ roles: Array.from(new Set([...existing.roles, 'admin' as const])) })
        .where(eq(employees.id, existing.id));
      console.log(`• ${adminEmail} already exists — made admin.`);
    } else {
      must(
        await createEmployee(db, null, { email: adminEmail, nameEn: adminEmail.split('@')[0]!, roles: ['admin', 'hr'] }),
        'admin',
      );
      console.log(`✓ Admin ${adminEmail} created. Sign in with that Google account.`);
    }
  } else if (!demo) {
    console.log('! Set SEED_ADMIN_EMAIL to create the first admin.');
  }

  if (demo) await seedDemo(db);
  process.exit(0);
}

async function seedDemo(db: Awaited<ReturnType<typeof createDb>>) {
  if ((await db.select().from(employees).where(eq(employees.email, 'khaled@example.com'))).length) {
    console.log('• Demo people already exist — skipped.');
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
  console.log('✓ Demo people added (sign in with AUTH_DEV_LOGIN=true).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
