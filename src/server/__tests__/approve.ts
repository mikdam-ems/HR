import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { employees } from '@/db/schema';
import * as ts from '../timesheets';

/** The person's manager (or an admin) approves a day change right away — for tests about what's on the timesheet. */
async function approved(db: DB, employeeId: string, r: Awaited<ReturnType<typeof ts.saveDay>>) {
  if (!r.ok || !r.value.requestId) return r;
  const [e] = await db.select().from(employees).where(eq(employees.id, employeeId));
  const [boss] = e?.managerId ? await db.select().from(employees).where(eq(employees.id, e.managerId)) : [];
  if (!boss) throw new Error('no manager to approve');
  const d = await ts.decideDayChange(db, { id: boss.id, roles: boss.roles }, r.value.requestId, 'approve');
  return d.ok ? r : d;
}

export const saveDay: typeof ts.saveDay = async (db, actor, employeeId, input) =>
  approved(db, employeeId, await ts.saveDay(db, actor, employeeId, input)) as ReturnType<typeof ts.saveDay>;

export const resetDay: typeof ts.resetDay = async (db, actor, employeeId, date) =>
  approved(db, employeeId, await ts.resetDay(db, actor, employeeId, date)) as ReturnType<typeof ts.resetDay>;
