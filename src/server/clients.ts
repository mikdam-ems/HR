import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { DB } from '@/db';
import { calendars, clients, holidays } from '@/db/schema';
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
