import ExcelJS from 'exceljs';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { auditLog, employees } from '@/db/schema';
import { createDepartment, listDepartments, updateDepartment } from '../departments';
import { applyPeopleImport, parsePeopleWorkbook } from '../importPeople';
import { createEmployee } from '../people';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE audit_log, departments, employees CASCADE`);
});

async function person(email: string, extra: Record<string, unknown> = {}) {
  const r = await createEmployee(db, null, { email, nameEn: email.split('@')[0]!, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('departments', () => {
  it('creates a department with a head and lists its active members', async () => {
    const head = await person('hiba@ems.com');
    const id = await createDepartment(db, null, { nameEn: 'UX/UI', nameAr: 'تجربة المستخدم', headId: head.id });
    expect(id.ok).toBe(true);
    if (!id.ok) return;
    await person('maya@ems.com', { departmentId: id.value });
    await person('gone@ems.com', { departmentId: id.value, active: false });

    const [d] = await listDepartments(db);
    expect(d).toMatchObject({ nameEn: 'UX/UI', head: { email: 'hiba@ems.com' } });
    expect(d!.members.map((m) => m.email)).toEqual(['maya@ems.com']);
  });

  it('rejects an unknown head and audits changes', async () => {
    const bad = await createDepartment(db, null, { nameEn: 'QA', headId: '00000000-0000-4000-8000-000000000000' });
    expect(bad).toMatchObject({ ok: false, error: 'not_found' });

    const created = await createDepartment(db, null, { nameEn: 'QA' });
    if (!created.ok) throw new Error(created.error);
    expect((await updateDepartment(db, null, created.value, { nameEn: 'Quality Assurance' })).ok).toBe(true);
    const [d] = await listDepartments(db);
    expect(d!.nameEn).toBe('Quality Assurance');
    expect((await db.select().from(auditLog)).length).toBeGreaterThanOrEqual(2);
  });

  it('import matches the Department column by English or Arabic name', async () => {
    const dev = await createDepartment(db, null, { nameEn: 'Software & Development', nameAr: 'تطوير البرمجيات' });
    if (!dev.ok) throw new Error(dev.error);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('People');
    ws.addRow(['Email', 'Name (English)', 'Department']);
    ws.addRow(['rania@ems.com', 'Rania', 'software & development']);
    ws.addRow(['yousef@ems.com', 'Yousef', 'تطوير البرمجيات']);
    ws.addRow(['x@ems.com', 'X', 'Marketing']);
    const parsed = await parsePeopleWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()));

    const result = await applyPeopleImport(db, null, parsed.rows, { allowRoles: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Marketing');

    const ok = await applyPeopleImport(db, null, parsed.rows.slice(0, 2), { allowRoles: false });
    expect(ok.errors).toEqual([]);
    const [rania] = await db.select().from(employees).where(eq(employees.email, 'rania@ems.com'));
    expect(rania!.departmentId).toBe(dev.value);
  });
});
