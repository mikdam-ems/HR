import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { departments, employees } from '@/db/schema';
import { audit } from './audit';
import { type Result, fail, ok, parse } from './validation';

export async function listDepartments(db: DB) {
  return db.query.departments.findMany({
    orderBy: asc(departments.nameEn),
    with: { head: true, members: { where: eq(employees.active, true) } },
  });
}

export const departmentInput = z.object({
  nameEn: z.string().trim().min(1),
  nameAr: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  headId: z.string().uuid().nullish().transform((v) => v ?? null),
});

async function checkHead(db: DB, headId: string | null): Promise<Result<void>> {
  if (!headId) return ok(undefined);
  const [p] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, headId));
  return p ? ok(undefined) : fail('not_found', 'head');
}

export async function createDepartment(
  db: DB,
  actorId: string | null,
  input: z.input<typeof departmentInput>,
): Promise<Result<string>> {
  const parsed = parse(departmentInput, input);
  if (!parsed.ok) return parsed;
  const head = await checkHead(db, parsed.value.headId);
  if (!head.ok) return head;
  const [row] = await db.insert(departments).values(parsed.value).returning();
  await audit(db, { actorId, action: 'create', entity: 'department', entityId: row!.id, after: row });
  return ok(row!.id);
}

export async function updateDepartment(
  db: DB,
  actorId: string | null,
  id: string,
  input: z.input<typeof departmentInput>,
): Promise<Result<void>> {
  const parsed = parse(departmentInput, input);
  if (!parsed.ok) return parsed;
  const [before] = await db.select().from(departments).where(eq(departments.id, id));
  if (!before) return fail('not_found');
  const head = await checkHead(db, parsed.value.headId);
  if (!head.ok) return head;
  const [after] = await db.update(departments).set(parsed.value).where(eq(departments.id, id)).returning();
  await audit(db, { actorId, action: 'update', entity: 'department', entityId: id, before, after });
  return ok(undefined);
}
