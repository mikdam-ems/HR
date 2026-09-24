import { and, asc, eq, ne } from 'drizzle-orm';
import type { DB } from '@/db';
import { assignments, clients, employees, schedules, type Employee } from '@/db/schema';
import { audit } from './audit';
import { wouldCreateLoop } from './orgTree';
import {
  type AssignmentInput,
  type EmployeeInput,
  type Result,
  type ScheduleInput,
  assignmentInput,
  employeeInput,
  fail,
  isoDate,
  ok,
  parse,
  scheduleInput,
} from './validation';

export async function listEmployees(db: DB, opts: { includeInactive?: boolean } = {}): Promise<Employee[]> {
  const rows = await db.select().from(employees).orderBy(asc(employees.nameEn));
  return opts.includeInactive ? rows : rows.filter((e) => e.active);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getEmployeeProfile(db: DB, id: string) {
  if (!UUID.test(id)) return undefined;
  return db.query.employees.findFirst({
    where: eq(employees.id, id),
    with: {
      manager: true,
      reports: { orderBy: asc(employees.nameEn) },
      assignments: { with: { client: true }, orderBy: asc(assignments.startDate) },
      schedules: { orderBy: asc(schedules.effectiveFrom) },
    },
  });
}

async function checkManager(db: DB, employeeId: string | null, managerId: string | null): Promise<Result<void>> {
  if (!managerId) return ok(undefined);
  const all = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees);
  if (!all.some((p) => p.id === managerId)) return fail('not_found', 'manager');
  if (employeeId && wouldCreateLoop(employeeId, managerId, all)) return fail('manager_loop');
  return ok(undefined);
}

export async function createEmployee(db: DB, actorId: string | null, input: EmployeeInput): Promise<Result<Employee>> {
  const parsed = parse(employeeInput, input);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  if ((await db.select().from(employees).where(eq(employees.email, data.email))).length) return fail('email_taken');
  const mgr = await checkManager(db, null, data.managerId);
  if (!mgr.ok) return mgr;

  const [row] = await db.insert(employees).values(data).returning();
  await audit(db, { actorId, action: 'create', entity: 'employee', entityId: row!.id, after: row });
  return ok(row!);
}

export async function updateEmployee(
  db: DB,
  actorId: string | null,
  id: string,
  input: EmployeeInput,
): Promise<Result<Employee>> {
  const parsed = parse(employeeInput, input);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  const [before] = await db.select().from(employees).where(eq(employees.id, id));
  if (!before) return fail('not_found');
  const clash = await db
    .select()
    .from(employees)
    .where(and(eq(employees.email, data.email), ne(employees.id, id)));
  if (clash.length) return fail('email_taken');
  const mgr = await checkManager(db, id, data.managerId);
  if (!mgr.ok) return mgr;

  const [row] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
  await audit(db, { actorId, action: 'update', entity: 'employee', entityId: id, before, after: row });
  return ok(row!);
}

const overlaps = (aStart: string, aEnd: string | null, bStart: string, bEnd: string | null) =>
  aStart <= (bEnd ?? '9999-12-31') && bStart <= (aEnd ?? '9999-12-31');

export async function addAssignment(db: DB, actorId: string | null, input: AssignmentInput): Promise<Result<string>> {
  const parsed = parse(assignmentInput, input);
  if (!parsed.ok) return parsed;
  const a = parsed.value;
  if (a.endDate && a.endDate < a.startDate) return fail('end_before_start');
  if (!(await db.select().from(employees).where(eq(employees.id, a.employeeId))).length) return fail('not_found');
  if (!(await db.select().from(clients).where(eq(clients.id, a.clientId))).length) return fail('unknown_client');

  const existing = await db.select().from(assignments).where(eq(assignments.employeeId, a.employeeId));
  const overlapping = existing.filter((e) => overlaps(e.startDate, e.endDate, a.startDate, a.endDate));
  if (overlapping.some((e) => e.clientId === a.clientId)) return fail('duplicate_assignment');
  // Two primaries at once would make the work week ambiguous; HR must end or unmark the other first.
  if (a.primary && overlapping.some((e) => e.primary)) return fail('primary_overlap');

  const [row] = await db.insert(assignments).values(a).returning();
  await audit(db, { actorId, action: 'create', entity: 'assignment', entityId: row!.id, after: row });
  return ok(row!.id);
}

export async function endAssignment(
  db: DB,
  actorId: string | null,
  assignmentId: string,
  endDate: string,
): Promise<Result<void>> {
  const d = parse(isoDate, endDate);
  if (!d.ok) return d;
  const [before] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  if (!before) return fail('not_found');
  if (d.value < before.startDate) return fail('end_before_start');
  const [after] = await db
    .update(assignments)
    .set({ endDate: d.value })
    .where(eq(assignments.id, assignmentId))
    .returning();
  await audit(db, { actorId, action: 'update', entity: 'assignment', entityId: assignmentId, before, after });
  return ok(undefined);
}

export async function removeAssignment(db: DB, actorId: string | null, assignmentId: string): Promise<Result<void>> {
  const [before] = await db.delete(assignments).where(eq(assignments.id, assignmentId)).returning();
  if (!before) return fail('not_found');
  await audit(db, { actorId, action: 'delete', entity: 'assignment', entityId: assignmentId, before });
  return ok(undefined);
}

/** Adds a schedule, or replaces the one starting on the same date. */
export async function setSchedule(db: DB, actorId: string | null, input: ScheduleInput): Promise<Result<void>> {
  const parsed = parse(scheduleInput, input);
  if (!parsed.ok) return parsed;
  const s = parsed.value;
  if (!(await db.select().from(employees).where(eq(employees.id, s.employeeId))).length) return fail('not_found');

  const where = and(eq(schedules.employeeId, s.employeeId), eq(schedules.effectiveFrom, s.effectiveFrom));
  const [before] = await db.select().from(schedules).where(where);
  const [after] = before
    ? await db.update(schedules).set(s).where(where).returning()
    : await db.insert(schedules).values(s).returning();
  await audit(db, { actorId, action: before ? 'update' : 'create', entity: 'schedule', entityId: after!.id, before, after });
  return ok(undefined);
}

export async function removeSchedule(db: DB, actorId: string | null, scheduleId: string): Promise<Result<void>> {
  const [before] = await db.delete(schedules).where(eq(schedules.id, scheduleId)).returning();
  if (!before) return fail('not_found');
  await audit(db, { actorId, action: 'delete', entity: 'schedule', entityId: scheduleId, before });
  return ok(undefined);
}
