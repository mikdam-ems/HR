import { and, asc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { clientShifts, clients, monthClosures, seasonalHours } from '@/db/schema';
import { eachDay } from '@/domain';
import { audit } from './audit';
import { type Result, fail, hhmm, isoDate, ok, parse } from './validation';

/** Ramadan or summer hours at a client for a date range. */
export const seasonInput = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  fromDate: isoDate,
  toDate: isoDate,
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  /** Empty means everyone at the client. */
  clientShiftId: z
    .string()
    .uuid()
    .nullish()
    .or(z.literal('').transform(() => null)),
});

/** The longest special-hours period HR can enter at once. Ramadan is 30 days; summer hours can run a few months. */
const MAX_DAYS = 184;

export async function listSeasons(db: DB, clientId: string) {
  return db.select().from(seasonalHours).where(eq(seasonalHours.clientId, clientId)).orderBy(asc(seasonalHours.fromDate));
}

/** True when any month the range touches is closed for payroll. */
async function touchesClosedMonth(db: DB, from: string, to: string): Promise<boolean> {
  const months = [...new Set(eachDay(from, to).map((d) => d.slice(0, 7)))];
  const rows = await db
    .select()
    .from(monthClosures)
    .where(or(...months.map((m) => and(eq(monthClosures.year, Number(m.slice(0, 4))), eq(monthClosures.month, Number(m.slice(5, 7)))))));
  return rows.length > 0;
}

/**
 * Adds special hours for a client. Refused for dates in a closed month (payroll is done) and when they overlap other
 * special hours for the same people, so there's never a question of which hours apply.
 */
export async function createSeason(db: DB, actorId: string | null, input: z.input<typeof seasonInput>): Promise<Result<string>> {
  const parsed = parse(seasonInput, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.toDate < v.fromDate) return fail('end_before_start');
  if (eachDay(v.fromDate, v.toDate).length > MAX_DAYS) return fail('invalid_input', `at most ${MAX_DAYS} days`);
  if (v.startTime === v.endTime) return fail('invalid_input', 'start and end are the same');
  if (!(await db.select().from(clients).where(eq(clients.id, v.clientId))).length) return fail('unknown_client');
  if (v.clientShiftId) {
    const [shift] = await db.select().from(clientShifts).where(eq(clientShifts.id, v.clientShiftId));
    if (!shift || shift.clientId !== v.clientId) return fail('unknown_shift');
  }
  const others = await listSeasons(db, v.clientId);
  const clash = others.some(
    (o) =>
      o.fromDate <= v.toDate &&
      o.toDate >= v.fromDate &&
      (!o.clientShiftId || !v.clientShiftId || o.clientShiftId === v.clientShiftId),
  );
  if (clash) return fail('season_overlap');
  if (await touchesClosedMonth(db, v.fromDate, v.toDate)) return fail('month_closed');
  const [row] = await db
    .insert(seasonalHours)
    .values({ ...v, clientShiftId: v.clientShiftId ?? null })
    .returning();
  await audit(db, { actorId, action: 'create', entity: 'seasonal_hours', entityId: row!.id, after: row });
  return ok(row!.id);
}

/** Removes special hours. Refused once any of their dates is in a closed month. */
export async function deleteSeason(db: DB, actorId: string | null, id: string): Promise<Result<void>> {
  const [before] = await db.select().from(seasonalHours).where(eq(seasonalHours.id, id));
  if (!before) return fail('not_found');
  if (await touchesClosedMonth(db, before.fromDate, before.toDate)) return fail('month_closed');
  await db.delete(seasonalHours).where(eq(seasonalHours.id, id));
  await audit(db, { actorId, action: 'delete', entity: 'seasonal_hours', entityId: id, before });
  return ok(undefined);
}
