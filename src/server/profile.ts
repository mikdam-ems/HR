import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { employeePhotos, employees, type Employee } from '@/db/schema';
import { STATUS_DURATIONS, isStatusVisible, statusShowsUntil } from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { type Result, fail, isoDate, ok, parse } from './validation';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** What people may change about themselves: their bio (and photo, below). Name, title and the rest stay with People & Culture. */
export const ownProfileInput = z.object({
  bio: optional(500),
  // Only the day and month are ever shown to colleagues.
  birthDate: isoDate.nullish(),
});

export async function updateOwnProfile(db: DB, actorId: string, input: z.input<typeof ownProfileInput>): Promise<Result<void>> {
  const parsed = parse(ownProfileInput, input);
  if (!parsed.ok) return parsed;
  const [before] = await db.select().from(employees).where(eq(employees.id, actorId));
  if (!before) return fail('not_found');
  const [after] = await db.update(employees).set(parsed.value).where(eq(employees.id, actorId)).returning();
  await audit(db, { actorId, action: 'update', entity: 'profile', entityId: actorId, before, after });
  return ok(undefined);
}

/** Photos arrive already resized in the browser (256 px); this is a safety limit, not the normal size. */
export const MAX_PHOTO_CHARS = 400_000;
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export async function setPhoto(db: DB, actorId: string, dataUrl: string | null): Promise<Result<void>> {
  if (dataUrl !== null && (!PHOTO.test(dataUrl) || dataUrl.length > MAX_PHOTO_CHARS)) {
    return fail('invalid_input', 'photo');
  }
  if (dataUrl) {
    await db
      .insert(employeePhotos)
      .values({ employeeId: actorId, dataUrl })
      .onConflictDoUpdate({ target: employeePhotos.employeeId, set: { dataUrl, updatedAt: new Date() } });
  } else {
    await db.delete(employeePhotos).where(eq(employeePhotos.employeeId, actorId));
  }
  await db.update(employees).set({ photoUpdatedAt: dataUrl ? new Date() : null }).where(eq(employees.id, actorId));
  await audit(db, { actorId, action: dataUrl ? 'update' : 'delete', entity: 'photo', entityId: actorId });
  return ok(undefined);
}

export async function getPhoto(db: DB, employeeId: string): Promise<string | null> {
  const [row] = await db.select().from(employeePhotos).where(eq(employeePhotos.employeeId, employeeId));
  return row?.dataUrl ?? null;
}

export const statusInput = z.object({
  emoji: z.string().trim().min(1).max(16),
  text: optional(80),
  duration: z.enum(STATUS_DURATIONS).default('today'),
});

/** Sets a status for today, this week or until cleared (see statusShowsUntil); null clears it now. */
export async function setStatus(
  db: DB,
  actorId: string,
  input: z.input<typeof statusInput> | null,
  today = todayISO(),
): Promise<Result<void>> {
  let values = {
    statusEmoji: null as string | null,
    statusText: null as string | null,
    statusDate: null as string | null,
    statusUntil: null as string | null,
  };
  if (input) {
    const parsed = parse(statusInput, input);
    if (!parsed.ok) return parsed;
    const { emoji, text, duration } = parsed.value;
    values = { statusEmoji: emoji, statusText: text, statusDate: today, statusUntil: statusShowsUntil(duration, today) };
  }
  const [after] = await db.update(employees).set(values).where(eq(employees.id, actorId)).returning();
  if (!after) return fail('not_found');
  await audit(db, { actorId, action: input ? 'set' : 'clear', entity: 'status', entityId: actorId, after: values });
  return ok(undefined);
}

/** The person's status if it's up today (with its last day, null when it stays until cleared), else nothing. */
export function currentStatus(
  e: Pick<Employee, 'statusEmoji' | 'statusText' | 'statusDate' | 'statusUntil'>,
  today = todayISO(),
): { emoji: string; text: string | null; until: string | null } | null {
  if (!e.statusEmoji || !isStatusVisible({ setOn: e.statusDate, until: e.statusUntil }, today)) return null;
  return { emoji: e.statusEmoji, text: e.statusText, until: e.statusUntil };
}
