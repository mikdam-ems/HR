import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { type Employee, employees, leaveRequests, shiftSwaps, type ShiftSwapRow } from '@/db/schema';
import { isWorkday, resolveDay } from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { behalfOf } from './delegation';
import { approversOf, notify } from './notify';
import { type Approver, decidesFor } from './permissions';
import { loadRulesContext } from './rulesContext';
import { isMonthClosed, monthStatus } from './timesheets';
import { type Result, fail, isoDate, ok, parse } from './validation';

export const swapInput = z.object({
  colleagueId: z.string().uuid(),
  date: isoDate,
  note: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
});

const OPEN = ['asked', 'accepted'] as const;

/**
 * Whether two people can swap shifts on a date: a coming day, same main client, both working, different hours,
 * nobody on leave or already swapping, and both months still open for changes. Returns the client for links.
 */
async function checkSwap(db: DB, requesterId: string, colleagueId: string, date: string, ignoreId?: string): Promise<Result<string>> {
  if (requesterId === colleagueId || date < todayISO()) return fail('swap_not_possible');
  const [people, ctx, leave, open] = await Promise.all([
    db.select().from(employees).where(inArray(employees.id, [requesterId, colleagueId])),
    loadRulesContext(db),
    db
      .select()
      .from(leaveRequests)
      .where(
        and(
          inArray(leaveRequests.employeeId, [requesterId, colleagueId]),
          inArray(leaveRequests.status, ['pending', 'approved']),
          lte(leaveRequests.fromDate, date),
          gte(leaveRequests.toDate, date),
        ),
      ),
    db
      .select()
      .from(shiftSwaps)
      .where(
        and(
          eq(shiftSwaps.date, date),
          inArray(shiftSwaps.status, [...OPEN, 'approved']),
          or(
            inArray(shiftSwaps.requesterId, [requesterId, colleagueId]),
            inArray(shiftSwaps.colleagueId, [requesterId, colleagueId]),
          ),
        ),
      ),
  ]);
  if (people.length !== 2 || people.some((p) => !p.active)) return fail('swap_not_possible');
  if (leave.length || open.some((s) => s.id !== ignoreId)) return fail('swap_not_possible');
  const [a, b] = [resolveDay(ctx, requesterId, date), resolveDay(ctx, colleagueId, date)];
  const working = (d: typeof a) => isWorkday(d.dayType) && d.expectedMinutes > 0 && !!d.schedule;
  if (!working(a) || !working(b) || !a.primaryClientId || a.primaryClientId !== b.primaryClientId) return fail('swap_not_possible');
  const same = a.schedule!.start === b.schedule!.start && a.schedule!.end === b.schedule!.end;
  if (same) return fail('swap_not_possible');
  // A swap changes hours, so both months must still be open for changes.
  const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  if (await isMonthClosed(db, year, month)) return fail('month_closed');
  for (const id of [requesterId, colleagueId]) {
    const status = await monthStatus(db, id, year, month);
    if (status !== 'draft' && status !== 'returned') return fail('month_locked');
  }
  return ok(a.primaryClientId);
}

const names = (p: Employee) => ({ name: p.nameEn, nameAr: p.nameAr });
const rosterLink = (clientId: string, date: string) => `/clients/${clientId}/roster?week=${date}`;

async function load(db: DB, id: string) {
  const [swap] = await db.select().from(shiftSwaps).where(eq(shiftSwaps.id, id));
  if (!swap) return null;
  const people = await db.select().from(employees).where(inArray(employees.id, [swap.requesterId, swap.colleagueId]));
  const requester = people.find((p) => p.id === swap.requesterId)!;
  const colleague = people.find((p) => p.id === swap.colleagueId)!;
  return { swap, requester, colleague };
}

/** Asks a colleague to swap shifts on a date. They're told, and accept or decline on the roster. */
export async function requestSwap(db: DB, actor: Approver, input: z.input<typeof swapInput>): Promise<Result<string>> {
  const parsed = parse(swapInput, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const check = await checkSwap(db, actor.id, v.colleagueId, v.date);
  if (!check.ok) return check;
  const [row] = await db
    .insert(shiftSwaps)
    .values({ requesterId: actor.id, colleagueId: v.colleagueId, date: v.date, note: v.note })
    .returning();
  await audit(db, { actorId: actor.id, action: 'create', entity: 'shift_swap', entityId: row!.id, after: row });
  const [me] = await db.select().from(employees).where(eq(employees.id, actor.id));
  await notify(db, [v.colleagueId], 'swap_requested', { ...names(me!), date: v.date, note: v.note }, rosterLink(check.value, v.date));
  return ok(row!.id);
}

/** The colleague accepts (it goes to the requester's manager) or declines (it ends here). */
export async function respondSwap(db: DB, actor: Approver, id: string, answer: 'accept' | 'decline'): Promise<Result<void>> {
  const found = await load(db, id);
  if (!found) return fail('not_found');
  const { swap, requester, colleague } = found;
  if (swap.colleagueId !== actor.id) return fail('forbidden');
  if (swap.status !== 'asked') return fail('already_decided');
  if (answer === 'decline') {
    const after = await setStatus(db, swap, 'declined', actor.id);
    await audit(db, { actorId: actor.id, action: 'decline', entity: 'shift_swap', entityId: id, before: swap, after });
    await notify(db, [requester.id], 'swap_decided', { outcome: 'declined', date: swap.date, ...names(colleague) }, '/');
    return ok(undefined);
  }
  const check = await checkSwap(db, requester.id, colleague.id, swap.date, swap.id);
  if (!check.ok) return check;
  const [after] = await db.update(shiftSwaps).set({ status: 'accepted' }).where(eq(shiftSwaps.id, id)).returning();
  await audit(db, { actorId: actor.id, action: 'accept', entity: 'shift_swap', entityId: id, before: swap, after });
  await notify(
    db,
    await approversOf(db, requester),
    'swap_accepted',
    { ...names(requester), other: colleague.nameEn, otherAr: colleague.nameAr, date: swap.date },
    '/approvals',
  );
  return ok(undefined);
}

/** The requester's manager (or their stand-in) approves: from then on both people work each other's shift that day. */
export async function decideSwap(db: DB, actor: Approver, id: string, outcome: 'approve' | 'decline', note: string | null = null): Promise<Result<void>> {
  const found = await load(db, id);
  if (!found) return fail('not_found');
  const { swap, requester, colleague } = found;
  if (!decidesFor(actor, requester) || actor.id === colleague.id) return fail('forbidden');
  if (swap.status !== 'accepted') return fail('already_decided');
  if (outcome === 'approve') {
    const check = await checkSwap(db, requester.id, colleague.id, swap.date, swap.id);
    if (!check.ok) return check;
  }
  const behalf = await behalfOf(db, actor, requester);
  const after = await setStatus(db, swap, outcome === 'approve' ? 'approved' : 'declined', actor.id, note);
  await audit(db, {
    actorId: actor.id,
    action: outcome,
    entity: 'shift_swap',
    entityId: id,
    before: swap,
    after: { ...after, ...(behalf ? { onBehalfOf: behalf.managerId } : {}) },
  });
  const data = { outcome: outcome === 'approve' ? 'approved' : 'declined', date: swap.date, note, ...(behalf?.data ?? {}) };
  await notify(db, [requester.id, colleague.id], 'swap_decided', data, '/');
  return ok(undefined);
}

/** The requester withdraws a swap nobody has approved yet. */
export async function cancelSwap(db: DB, actor: Approver, id: string): Promise<Result<void>> {
  const [swap] = await db.select().from(shiftSwaps).where(eq(shiftSwaps.id, id));
  if (!swap) return fail('not_found');
  if (swap.requesterId !== actor.id) return fail('forbidden');
  if (!(OPEN as readonly string[]).includes(swap.status)) return fail('already_decided');
  const after = await setStatus(db, swap, 'cancelled', actor.id);
  await audit(db, { actorId: actor.id, action: 'cancel', entity: 'shift_swap', entityId: id, before: swap, after });
  return ok(undefined);
}

async function setStatus(db: DB, swap: ShiftSwapRow, status: ShiftSwapRow['status'], by: string, note: string | null = null) {
  const [after] = await db
    .update(shiftSwaps)
    .set({ status, decidedById: by, decidedAt: new Date(), ...(note ? { note } : {}) })
    .where(eq(shiftSwaps.id, swap.id))
    .returning();
  return after!;
}

/** A person's coming swaps, asked of them or by them, still open or approved, soonest first. */
export async function mySwaps(db: DB, employeeId: string) {
  const rows = await db
    .select()
    .from(shiftSwaps)
    .where(
      and(
        gte(shiftSwaps.date, todayISO()),
        inArray(shiftSwaps.status, [...OPEN, 'approved']),
        or(eq(shiftSwaps.requesterId, employeeId), eq(shiftSwaps.colleagueId, employeeId)),
      ),
    )
    .orderBy(asc(shiftSwaps.date));
  return rows;
}

/** Accepted swaps waiting for this person to decide (as the requester's manager or stand-in). */
export async function listPendingSwaps(db: DB, actor: Approver) {
  const rows = await db.select().from(shiftSwaps).where(eq(shiftSwaps.status, 'accepted')).orderBy(asc(shiftSwaps.date));
  if (!rows.length) return [];
  const people = await db.select().from(employees);
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows
    .map((swap) => ({ swap, requester: byId.get(swap.requesterId)!, colleague: byId.get(swap.colleagueId)! }))
    .filter((x) => decidesFor(actor, x.requester) && actor.id !== x.colleague.id);
}
