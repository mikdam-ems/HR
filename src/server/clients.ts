import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { DB } from '@/db';
import { assignments, calendars, clientShifts, clients, holidays } from '@/db/schema';
import { audit } from './audit';
import { type Result, calendarInput, clientInput, fail, holidayInput, ok, parse } from './validation';

export async function listCalendars(db: DB) {
  return db.query.calendars.findMany({
    orderBy: asc(calendars.name),
    with: { holidays: { orderBy: asc(holidays.date) }, clients: true },
  });
}

export async function getCalendar(db: DB, id: string) {
  return db.query.calendars.findFirst({
    where: eq(calendars.id, id),
    with: { holidays: { orderBy: asc(holidays.date) }, clients: true },
  });
}

export async function listClients(db: DB) {
  return db.query.clients.findMany({ orderBy: asc(clients.nameEn), with: { calendar: true } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A client with its calendar (and holidays) and everyone assigned to it, split into who is on it
 * today, who starts later, and who worked on it before. Inactive people are left out.
 */
export async function getClientProfile(db: DB, id: string, today: string) {
  if (!UUID.test(id)) return undefined;
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, id),
    with: {
      calendar: { with: { holidays: { orderBy: asc(holidays.date) } } },
      assignments: { orderBy: asc(assignments.startDate), with: { employee: { with: { department: true } } } },
    },
  });
  if (!client) return undefined;
  const active = client.assignments.filter((a) => a.employee.active);
  const current = active.filter((a) => a.startDate <= today && (!a.endDate || a.endDate >= today));
  const upcoming = active.filter((a) => a.startDate > today);
  const currentIds = new Set(current.map((a) => a.employeeId));
  // Past: people whose every assignment here has ended (latest end first), once each.
  const past = active
    .filter((a) => a.endDate && a.endDate < today && !currentIds.has(a.employeeId))
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))
    .filter((a, i, all) => all.findIndex((x) => x.employeeId === a.employeeId) === i);
  const upcomingHolidays = client.calendar.holidays.filter((h) => h.date >= today).slice(0, 4);
  return { client, current, upcoming, past, upcomingHolidays };
}

export type ClientProfile = NonNullable<Awaited<ReturnType<typeof getClientProfile>>>;

export async function createCalendar(
  db: DB,
  actorId: string | null,
  input: z.input<typeof calendarInput>,
): Promise<Result<string>> {
  const parsed = parse(calendarInput, input);
  if (!parsed.ok) return parsed;
  const [row] = await db.insert(calendars).values(parsed.value).returning();
  await audit(db, { actorId, action: 'create', entity: 'calendar', entityId: row!.id, after: row });
  return ok(row!.id);
}

export async function updateCalendar(
  db: DB,
  actorId: string | null,
  id: string,
  input: z.input<typeof calendarInput>,
): Promise<Result<void>> {
  const parsed = parse(calendarInput, input);
  if (!parsed.ok) return parsed;
  const [before] = await db.select().from(calendars).where(eq(calendars.id, id));
  if (!before) return fail('not_found');
  const [after] = await db.update(calendars).set(parsed.value).where(eq(calendars.id, id)).returning();
  await audit(db, { actorId, action: 'update', entity: 'calendar', entityId: id, before, after });
  return ok(undefined);
}

/** Adds a holiday, or renames the one already on that date. */
export async function setHoliday(
  db: DB,
  actorId: string | null,
  input: z.input<typeof holidayInput>,
): Promise<Result<void>> {
  const parsed = parse(holidayInput, input);
  if (!parsed.ok) return parsed;
  const h = parsed.value;
  if (!(await db.select().from(calendars).where(eq(calendars.id, h.calendarId))).length) return fail('unknown_calendar');
  const where = and(eq(holidays.calendarId, h.calendarId), eq(holidays.date, h.date));
  const [before] = await db.select().from(holidays).where(where);
  const [after] = before
    ? await db.update(holidays).set(h).where(where).returning()
    : await db.insert(holidays).values(h).returning();
  await audit(db, { actorId, action: before ? 'update' : 'create', entity: 'holiday', entityId: after!.id, before, after });
  return ok(undefined);
}

export async function removeHoliday(db: DB, actorId: string | null, id: string): Promise<Result<void>> {
  const [before] = await db.delete(holidays).where(eq(holidays.id, id)).returning();
  if (!before) return fail('not_found');
  await audit(db, { actorId, action: 'delete', entity: 'holiday', entityId: id, before });
  return ok(undefined);
}

export async function createClient(
  db: DB,
  actorId: string | null,
  input: z.input<typeof clientInput>,
): Promise<Result<string>> {
  const parsed = parse(clientInput, input);
  if (!parsed.ok) return parsed;
  if (!(await db.select().from(calendars).where(eq(calendars.id, parsed.value.calendarId))).length) {
    return fail('unknown_calendar');
  }
  const [row] = await db.insert(clients).values(parsed.value).returning();
  await audit(db, { actorId, action: 'create', entity: 'client', entityId: row!.id, after: row });
  // Every client starts with the standard 8h30 day; HR edits it or adds shifts on the client's page.
  const [shift] = await db
    .insert(clientShifts)
    .values({ clientId: row!.id, name: 'Standard', startTime: '09:00', endTime: '17:30' })
    .returning();
  await audit(db, { actorId, action: 'create', entity: 'client_shift', entityId: shift!.id, after: shift });
  return ok(row!.id);
}

export async function updateClient(
  db: DB,
  actorId: string | null,
  id: string,
  input: z.input<typeof clientInput>,
): Promise<Result<void>> {
  const parsed = parse(clientInput, input);
  if (!parsed.ok) return parsed;
  const [before] = await db.select().from(clients).where(eq(clients.id, id));
  if (!before) return fail('not_found');
  if (!(await db.select().from(calendars).where(eq(calendars.id, parsed.value.calendarId))).length) {
    return fail('unknown_calendar');
  }
  const [after] = await db.update(clients).set(parsed.value).where(eq(clients.id, id)).returning();
  await audit(db, { actorId, action: 'update', entity: 'client', entityId: id, before, after });
  return ok(undefined);
}
