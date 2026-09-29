import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { approvalDelegations, type Employee, employees } from '@/db/schema';
import { eachDay } from '@/domain';
import { todayISO } from '@/lib/format';
import { audit } from './audit';
import { type Approver, can, onBehalfOf } from './permissions';
import { type Result, fail, isoDate, ok, parse } from './validation';

/** Long enough for Hajj or a long trip; anything longer is a change of manager, which HR does on the person. */
const MAX_DAYS = 62;

export const delegationInput = z.object({
  managerId: z.string().uuid(),
  deputyId: z.string().uuid(),
  fromDate: isoDate,
  toDate: isoDate,
});

/** Managers this person stands in for on `date`. Loaded with the signed-in user. */
export async function standingInFor(db: DB, deputyId: string, date = todayISO()): Promise<string[]> {
  const rows = await db
    .select({ managerId: approvalDelegations.managerId })
    .from(approvalDelegations)
    .where(and(eq(approvalDelegations.deputyId, deputyId), lte(approvalDelegations.fromDate, date), gte(approvalDelegations.toDate, date)));
  return [...new Set(rows.map((r) => r.managerId))];
}

/** A manager's hand-overs that haven't ended yet, soonest first, with the stand-in. */
export async function listDelegations(db: DB, managerId: string, date = todayISO()) {
  return db.query.approvalDelegations.findMany({
    where: and(eq(approvalDelegations.managerId, managerId), gte(approvalDelegations.toDate, date)),
    orderBy: asc(approvalDelegations.fromDate),
    with: { deputy: true },
  });
}

/** Only the manager themselves, or People & Culture, can hand a manager's approvals over. */
const mayArrange = (actor: Approver, managerId: string) => actor.id === managerId || can(actor, 'people.manage');

export async function createDelegation(db: DB, actor: Approver, input: z.input<typeof delegationInput>): Promise<Result<string>> {
  const parsed = parse(delegationInput, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!mayArrange(actor, v.managerId)) return fail('forbidden');
  if (v.deputyId === v.managerId) return fail('invalid_input', 'someone can’t stand in for themselves');
  if (v.toDate < v.fromDate) return fail('end_before_start');
  if (v.toDate < todayISO()) return fail('invalid_input', 'those dates are over');
  if (eachDay(v.fromDate, v.toDate).length > MAX_DAYS) return fail('invalid_input', `at most ${MAX_DAYS} days`);
  const [deputy] = await db.select().from(employees).where(eq(employees.id, v.deputyId));
  if (!deputy?.active) return fail('not_found', 'stand-in');
  // One stand-in at a time, so it's always clear who decides.
  const clash = await db
    .select()
    .from(approvalDelegations)
    .where(and(eq(approvalDelegations.managerId, v.managerId), lte(approvalDelegations.fromDate, v.toDate), gte(approvalDelegations.toDate, v.fromDate)));
  if (clash.length) return fail('delegation_overlap');
  const [row] = await db
    .insert(approvalDelegations)
    .values({ ...v, createdById: actor.id })
    .returning();
  await audit(db, { actorId: actor.id, action: 'create', entity: 'approval_delegation', entityId: row!.id, after: row });
  return ok(row!.id);
}

export async function cancelDelegation(db: DB, actor: Approver, id: string): Promise<Result<void>> {
  const [before] = await db.select().from(approvalDelegations).where(eq(approvalDelegations.id, id));
  if (!before) return fail('not_found');
  if (!mayArrange(actor, before.managerId)) return fail('forbidden');
  await db.delete(approvalDelegations).where(eq(approvalDelegations.id, id));
  await audit(db, { actorId: actor.id, action: 'delete', entity: 'approval_delegation', entityId: id, before });
  return ok(undefined);
}

/**
 * When a stand-in decides, the words for the person's notification ("decided by Omar for Khaled") and the manager's
 * id for the audit log. Empty when the manager (or an admin) decides it themselves.
 */
export async function behalfOf(
  db: DB,
  actor: Approver,
  employee: Pick<Employee, 'managerId'>,
): Promise<{ managerId: string; data: Record<string, string | null> } | null> {
  const managerId = onBehalfOf(actor, employee);
  if (!managerId) return null;
  const [who, manager] = await Promise.all([
    db.select().from(employees).where(eq(employees.id, actor.id)),
    db.select().from(employees).where(eq(employees.id, managerId)),
  ]);
  return {
    managerId,
    data: { by: who[0]?.nameEn ?? '', byAr: who[0]?.nameAr ?? null, for: manager[0]?.nameEn ?? '', forAr: manager[0]?.nameAr ?? null },
  };
}
