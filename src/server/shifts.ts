import { asc, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { clientShifts, clients, schedules } from '@/db/schema';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { putOnShift } from './people';
import { type Result, fail, hhmm, ok, parse } from './validation';

/** A client's working hours: one "Standard" shift, or several (e.g. A / B / C for a 24/7 client). */
export const shiftInput = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  sortOrder: z.coerce.number().int().min(0).max(99).default(0),
});

export async function listShifts(db: DB, clientId: string, includeInactive = false) {
  const rows = await db
    .select()
    .from(clientShifts)
    .where(eq(clientShifts.clientId, clientId))
    .orderBy(asc(clientShifts.sortOrder), asc(clientShifts.startTime));
  return includeInactive ? rows : rows.filter((r) => r.active);
}

/** Every active shift with its client, for pickers ("Hala — Shift A 06:00–14:00"). */
export async function allShifts(db: DB) {
  return db.query.clientShifts.findMany({
    where: eq(clientShifts.active, true),
    with: { client: true },
    orderBy: [asc(clientShifts.sortOrder), asc(clientShifts.startTime)],
  });
}

export async function createShift(db: DB, actorId: string | null, input: z.input<typeof shiftInput>): Promise<Result<string>> {
  const parsed = parse(shiftInput, input);
  if (!parsed.ok) return parsed;
  if (parsed.value.startTime === parsed.value.endTime) return fail('invalid_input', 'start and end are the same');
  if (!(await db.select().from(clients).where(eq(clients.id, parsed.value.clientId))).length) return fail('unknown_client');
  const [row] = await db.insert(clientShifts).values(parsed.value).returning();
  await audit(db, { actorId, action: 'create', entity: 'client_shift', entityId: row!.id, after: row });
  return ok(row!.id);
}

/** People whose current schedule (on `date`) comes from this shift. */
async function peopleOnShift(db: DB, shiftId: string, date: string): Promise<string[]> {
  const rows = await db.select().from(schedules).where(lte(schedules.effectiveFrom, date)).orderBy(desc(schedules.effectiveFrom));
  const current = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!current.has(r.employeeId)) current.set(r.employeeId, r);
  return [...current.values()].filter((r) => r.clientShiftId === shiftId).map((r) => r.employeeId);
}

/**
 * Changes a shift's name or hours. Everyone on it moves to the new hours from `from` (default today);
 * earlier days keep the hours they had.
 */
export async function updateShift(
  db: DB,
  actorId: string | null,
  id: string,
  input: z.input<typeof shiftInput>,
  from = todayISO(),
): Promise<Result<void>> {
  const parsed = parse(shiftInput, input);
  if (!parsed.ok) return parsed;
  const [before] = await db.select().from(clientShifts).where(eq(clientShifts.id, id));
  if (!before || before.clientId !== parsed.value.clientId) return fail('unknown_shift');
  if (parsed.value.startTime === parsed.value.endTime) return fail('invalid_input', 'start and end are the same');
  const [after] = await db.update(clientShifts).set(parsed.value).where(eq(clientShifts.id, id)).returning();
  await audit(db, { actorId, action: 'update', entity: 'client_shift', entityId: id, before, after });
  const hoursChanged =
    before.startTime !== after!.startTime || before.endTime !== after!.endTime || before.breakMinutes !== after!.breakMinutes || before.name !== after!.name;
  if (hoursChanged) {
    for (const employeeId of await peopleOnShift(db, id, from)) {
      const applied = await putOnShift(db, actorId, employeeId, id, from);
      if (!applied.ok) return applied;
    }
  }
  return ok(undefined);
}

/** Retires a shift: it disappears from pickers; people already on it keep their hours until moved. */
export async function deactivateShift(db: DB, actorId: string | null, id: string): Promise<Result<void>> {
  const [before] = await db.select().from(clientShifts).where(eq(clientShifts.id, id));
  if (!before) return fail('unknown_shift');
  const [after] = await db.update(clientShifts).set({ active: false }).where(eq(clientShifts.id, id)).returning();
  await audit(db, { actorId, action: 'deactivate', entity: 'client_shift', entityId: id, before, after });
  return ok(undefined);
}

/** Who is on each of a client's shifts today. */
export async function shiftRoster(db: DB, clientId: string, date = todayISO()) {
  const shifts = await listShifts(db, clientId);
  const out: Record<string, string[]> = {};
  for (const s of shifts) out[s.id] = await peopleOnShift(db, s.id, date);
  return out;
}

