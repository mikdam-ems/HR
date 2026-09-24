import ExcelJS from 'exceljs';
import type { DB } from '@/db';
import { employees, roleEnum, type Employee, type Role } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { toUtcMs } from '@/domain';
import { audit } from './audit';
import { wouldCreateLoop } from './orgTree';

/** Column headings, in template order. Matching is case-insensitive. */
export const PEOPLE_COLUMNS = {
  email: 'Email',
  nameEn: 'Name (English)',
  nameAr: 'Name (Arabic)',
  jobTitle: 'Job title',
  managerEmail: 'Manager email',
  hireDate: 'Hire date',
  roles: 'Roles',
} as const;
type Column = keyof typeof PEOPLE_COLUMNS;

export interface ImportRow {
  /** Row number in the sheet, for error messages. */
  row: number;
  email: string;
  nameEn: string | null;
  nameAr: string | null;
  jobTitle: string | null;
  managerEmail: string | null;
  hireDate: string | null;
  roles: Role[] | null;
}

export interface ImportError {
  row: number | null;
  message: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: ImportError[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('').trim();
    if ('text' in value) return String(value.text).trim(); // hyperlinks, e.g. emails
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue); // formulas
    return '';
  }
  return String(value).trim();
}

/** Accepts a real Excel date, YYYY-MM-DD, DD/MM/YYYY or an Excel serial number. */
function parseDate(value: ExcelJS.CellValue): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  let iso: string;
  if (value instanceof Date) iso = value.toISOString().slice(0, 10);
  else if (typeof value === 'number') iso = new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  else {
    const text = cellText(value);
    if (!text) return null;
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    iso = dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}` : text;
  }
  try {
    toUtcMs(iso);
    return iso;
  } catch {
    return 'invalid';
  }
}

export async function parsePeopleWorkbook(
  data: ArrayBuffer | Uint8Array,
): Promise<{ rows: ImportRow[]; errors: ImportError[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as ArrayBuffer);
  } catch {
    return { rows: [], errors: [{ row: null, message: 'This is not a readable .xlsx file.' }] };
  }
  const sheet = wb.worksheets[0];
  if (!sheet) return { rows: [], errors: [{ row: null, message: 'The file has no sheets.' }] };

  const colOf: Partial<Record<Column, number>> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const heading = cellText(cell.value).toLowerCase();
    for (const [key, label] of Object.entries(PEOPLE_COLUMNS)) {
      if (heading === label.toLowerCase()) colOf[key as Column] = col;
    }
  });
  const missing = (['email', 'nameEn'] as const).filter((c) => !colOf[c]);
  if (missing.length) {
    return {
      rows: [],
      errors: [{ row: 1, message: `Missing column(s): ${missing.map((c) => PEOPLE_COLUMNS[c]).join(', ')}` }],
    };
  }

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seen = new Map<string, number>();

  sheet.eachRow((r, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = (c: Column) => (colOf[c] ? r.getCell(colOf[c]!).value : null);
    const text = (c: Column) => cellText(raw(c)) || null;
    const email = (text('email') ?? '').toLowerCase();
    if (!email && !text('nameEn')) return; // blank row

    const err = (message: string) => errors.push({ row: rowNumber, message });
    if (!EMAIL.test(email)) return err(`"${email || '(empty)'}" is not a valid email.`);
    if (seen.has(email)) return err(`${email} also appears on row ${seen.get(email)}.`);
    seen.set(email, rowNumber);

    const managerEmail = text('managerEmail')?.toLowerCase() ?? null;
    if (managerEmail && !EMAIL.test(managerEmail)) return err(`Manager email "${managerEmail}" is not valid.`);
    if (managerEmail === email) return err('A person cannot be their own manager.');

    const hireDate = parseDate(raw('hireDate'));
    if (hireDate === 'invalid') return err(`Hire date "${cellText(raw('hireDate'))}" is not a date.`);

    let roles: Role[] | null = null;
    const rolesText = text('roles');
    if (rolesText) {
      const parts = rolesText.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const bad = parts.filter((p) => !(roleEnum.enumValues as readonly string[]).includes(p));
      if (bad.length) return err(`Unknown role(s): ${bad.join(', ')}. Use employee, hr, finance or admin.`);
      roles = Array.from(new Set(['employee', ...parts])) as Role[];
    }

    rows.push({
      row: rowNumber,
      email,
      nameEn: text('nameEn'),
      nameAr: text('nameAr'),
      jobTitle: text('jobTitle'),
      managerEmail,
      hireDate,
      roles,
    });
  });

  return { rows, errors };
}

class ImportAborted extends Error {
  constructor(public errors: ImportError[]) {
    super('import aborted');
  }
}

/**
 * Creates new people and updates existing ones (matched by email). All or nothing: if any row has a
 * problem, nothing is saved. Blank cells leave an existing person's value unchanged; people not in the
 * file are left alone.
 */
export async function applyPeopleImport(
  db: DB,
  actorId: string | null,
  rows: ImportRow[],
  opts: { allowRoles: boolean },
): Promise<ImportResult> {
  if (!opts.allowRoles) {
    // Roles are admin-only; otherwise HR could make themselves admin through a spreadsheet.
    const withRoles = rows.filter((r) => r.roles && r.roles.some((role) => role !== 'employee'));
    if (withRoles.length) {
      return {
        created: 0,
        updated: 0,
        errors: withRoles.map((r) => ({ row: r.row, message: 'Only admins can set roles. Clear the Roles column.' })),
      };
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(employees);
      const byEmail = new Map(existing.map((e) => [e.email, e]));
      const fileEmails = new Set(rows.map((r) => r.email));
      const errors: ImportError[] = [];

      for (const r of rows) {
        if (!byEmail.has(r.email) && !r.nameEn) errors.push({ row: r.row, message: `${r.email} is new, so it needs a name.` });
        if (r.managerEmail && !fileEmails.has(r.managerEmail) && !byEmail.has(r.managerEmail)) {
          errors.push({ row: r.row, message: `Manager ${r.managerEmail} is not in the file or the system.` });
        }
      }
      if (errors.length) throw new ImportAborted(errors);

      let created = 0;
      let updated = 0;
      const saved = new Map<string, Employee>(byEmail);

      // Pass 1: create or update everyone without touching managers.
      for (const r of rows) {
        const before = byEmail.get(r.email);
        const fields = {
          ...(r.nameEn ? { nameEn: r.nameEn } : {}),
          ...(r.nameAr ? { nameAr: r.nameAr } : {}),
          ...(r.jobTitle ? { jobTitle: r.jobTitle } : {}),
          ...(r.hireDate ? { hireDate: r.hireDate } : {}),
          ...(r.roles ? { roles: r.roles } : {}),
        };
        if (before) {
          const [after] = await tx.update(employees).set(fields).where(eq(employees.id, before.id)).returning();
          saved.set(r.email, after!);
          await audit(tx, { actorId, action: 'import_update', entity: 'employee', entityId: before.id, before, after });
          updated++;
        } else {
          const [after] = await tx
            .insert(employees)
            .values({ email: r.email, nameEn: r.nameEn!, ...fields })
            .returning();
          saved.set(r.email, after!);
          await audit(tx, { actorId, action: 'import_create', entity: 'employee', entityId: after!.id, after });
          created++;
        }
      }

      // Pass 2: link managers, checking for loops against the final picture.
      const graph = new Map([...saved.values()].map((e) => [e.id, { id: e.id, managerId: e.managerId }]));
      for (const r of rows) {
        if (!r.managerEmail) continue;
        const person = saved.get(r.email)!;
        const managerId = saved.get(r.managerEmail)!.id;
        if (wouldCreateLoop(person.id, managerId, [...graph.values()])) {
          errors.push({ row: r.row, message: `Making ${r.managerEmail} the manager of ${r.email} creates a loop.` });
          continue;
        }
        graph.set(person.id, { id: person.id, managerId });
        await tx.update(employees).set({ managerId }).where(eq(employees.id, person.id));
      }
      if (errors.length) throw new ImportAborted(errors);

      return { created, updated, errors: [] };
    });
  } catch (e) {
    if (e instanceof ImportAborted) return { created: 0, updated: 0, errors: e.errors };
    throw e;
  }
}

/** An empty template with an example row and a short how-to sheet. */
export async function buildPeopleTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('People');
  sheet.columns = Object.values(PEOPLE_COLUMNS).map((header) => ({ header, width: 26 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(['sara@ems-itech.com', 'Sara Ahmad', 'سارة أحمد', 'Support Engineer', 'khaled@ems-itech.com', '2023-04-02', 'employee']);

  const help = wb.addWorksheet('How to fill');
  help.columns = [{ width: 110 }];
  for (const line of [
    'One row per person. Email and Name (English) are required for new people.',
    'Email must be the person’s Google account; it is how they sign in.',
    'Manager email must belong to someone in this file or already in the system.',
    'Hire date: YYYY-MM-DD or DD/MM/YYYY.',
    'Roles: employee (default), hr, finance, admin — separate several with commas.',
    'People already in the system are matched by email and updated. Blank cells leave their current value.',
    'If any row has a problem, nothing is imported and every problem is listed.',
  ]) {
    help.addRow([line]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
