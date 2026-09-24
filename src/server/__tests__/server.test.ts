import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '@/db';
import { auditLog, employees } from '@/db/schema';
import { resolveDay } from '@/domain';
import { createCalendar, createClient, setHoliday } from '../clients';
import { applyPeopleImport, buildPeopleTemplate, parsePeopleWorkbook } from '../importPeople';
import { buildOrgTree } from '../orgTree';
import { addAssignment, createEmployee, endAssignment, setSchedule, updateEmployee } from '../people';
import { can } from '../permissions';
import { loadRulesContext } from '../rulesContext';
import { setSetting } from '../settings';

let db: DB;
beforeAll(async () => {
  db = await createDb('memory');
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE audit_log, assignments, schedules, holidays, clients, calendars, settings, employees CASCADE`,
  );
});

async function person(email: string, extra: Record<string, unknown> = {}) {
  const r = await createEmployee(db, null, { email, nameEn: email.split('@')[0]!, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

async function workbook(rows: (string | Date | null)[][], headers = ['Email', 'Name (English)', 'Manager email', 'Hire date', 'Roles']) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('People');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('people', () => {
  it('stores emails lower-case and always includes the employee role', async () => {
    const p = await person('Lina@EMS-itech.com', { roles: ['hr'] });
    expect(p.email).toBe('lina@ems-itech.com');
    expect(p.roles.sort()).toEqual(['employee', 'hr']);
  });

  it('rejects a duplicate email', async () => {
    await person('a@x.com');
    const r = await createEmployee(db, null, { email: 'A@x.com', nameEn: 'Again' });
    expect(r).toMatchObject({ ok: false, error: 'email_taken' });
  });

  it('rejects a manager loop', async () => {
    const boss = await person('boss@x.com');
    const lead = await person('lead@x.com', { managerId: boss.id });
    const r = await updateEmployee(db, null, boss.id, { email: boss.email, nameEn: 'Boss', managerId: lead.id });
    expect(r).toMatchObject({ ok: false, error: 'manager_loop' });
  });

  it('writes an audit entry for every change', async () => {
    const p = await person('a@x.com');
    await updateEmployee(db, p.id, p.id, { email: p.email, nameEn: 'Renamed' });
    const log = await db.select().from(auditLog).where(eq(auditLog.entityId, p.id));
    expect(log.map((l) => l.action)).toEqual(['create', 'update']);
  });
});

describe('assignments and rules from the database', () => {
  async function setup() {
    const sa = await createCalendar(db, null, { name: 'Saudi', workWeek: [0, 1, 2, 3, 4] });
    const jo = await createCalendar(db, null, { name: 'Jordan', workWeek: [0, 1, 2, 3, 4] });
    if (!sa.ok || !jo.ok) throw new Error('calendar');
    await setHoliday(db, null, { calendarId: sa.value, date: '2026-09-23', nameEn: 'Saudi National Day' });
    await setHoliday(db, null, { calendarId: jo.value, date: '2026-05-25', nameEn: 'Independence Day' });
    await setSetting(db, 'homeCalendarId', jo.value);
    const jadwa = await createClient(db, null, { nameEn: 'Jadwa Investment', calendarId: sa.value });
    if (!jadwa.ok) throw new Error('client');
    const omar = await person('omar@x.com');
    await addAssignment(db, null, { employeeId: omar.id, clientId: jadwa.value, startDate: '2026-01-01' });
    await setSchedule(db, null, { employeeId: omar.id, effectiveFrom: '2026-01-01', startTime: '09:00', endTime: '17:00' });
    return { omar, jadwa: jadwa.value };
  }

  it('feeds the rules engine: client holiday, special overtime, working day', async () => {
    const { omar } = await setup();
    const ctx = await loadRulesContext(db);
    expect(resolveDay(ctx, omar.id, '2026-09-23').dayType).toBe('client_holiday');
    expect(resolveDay(ctx, omar.id, '2026-05-25').dayType).toBe('special_overtime');
    const normal = resolveDay(ctx, omar.id, '2026-09-24');
    expect(normal.dayType).toBe('working');
    expect(normal.expectedMinutes).toBe(480);
  });

  it('refuses two primary assignments at the same time', async () => {
    const { omar, jadwa } = await setup();
    const calendarId = (await loadRulesContext(db)).clients[jadwa]!.calendarId;
    const other = await createClient(db, null, { nameEn: 'Client B', calendarId });
    if (!other.ok) throw new Error('client');
    const r = await addAssignment(db, null, { employeeId: omar.id, clientId: other.value, startDate: '2026-06-01' });
    expect(r).toMatchObject({ ok: false, error: 'primary_overlap' });
    const secondary = await addAssignment(db, null, {
      employeeId: omar.id,
      clientId: other.value,
      startDate: '2026-06-01',
      primary: false,
    });
    expect(secondary.ok).toBe(true);
  });

  it('allows a move to a new client once the old assignment ends', async () => {
    const { omar, jadwa } = await setup();
    const ctx0 = await loadRulesContext(db);
    const current = ctx0.assignments.find((a) => a.employeeId === omar.id)!;
    const [row] = await db.query.assignments.findMany({ where: (a, { eq }) => eq(a.employeeId, omar.id) });
    expect(current.end).toBeNull();
    expect((await endAssignment(db, null, row!.id, '2026-06-30')).ok).toBe(true);
    const r = await addAssignment(db, null, { employeeId: omar.id, clientId: jadwa, startDate: '2026-07-01' });
    expect(r.ok).toBe(true);
  });

  it('refuses the same client twice for overlapping dates', async () => {
    const { omar, jadwa } = await setup();
    const r = await addAssignment(db, null, { employeeId: omar.id, clientId: jadwa, startDate: '2026-03-01', primary: false });
    expect(r).toMatchObject({ ok: false, error: 'duplicate_assignment' });
  });

  it('rejects an end date before the start', async () => {
    const { omar, jadwa } = await setup();
    const r = await addAssignment(db, null, {
      employeeId: omar.id,
      clientId: jadwa,
      startDate: '2027-02-01',
      endDate: '2027-01-01',
    });
    expect(r).toMatchObject({ ok: false, error: 'end_before_start' });
  });
});

describe('Excel import', () => {
  it('creates people and links managers, even when the manager is listed later', async () => {
    const data = await workbook([
      ['sara@ems.com', 'Sara', 'khaled@ems.com', '02/04/2023', ''],
      ['khaled@ems.com', 'Khaled', '', new Date(Date.UTC(2020, 0, 5)), 'hr, admin'],
    ]);
    const parsed = await parsePeopleWorkbook(data);
    expect(parsed.errors).toEqual([]);
    const result = await applyPeopleImport(db, null, parsed.rows, { allowRoles: true });
    expect(result).toEqual({ created: 2, updated: 0, errors: [] });

    const all = await db.select().from(employees);
    const sara = all.find((e) => e.email === 'sara@ems.com')!;
    const khaled = all.find((e) => e.email === 'khaled@ems.com')!;
    expect(sara.managerId).toBe(khaled.id);
    expect(sara.hireDate).toBe('2023-04-02');
    expect(khaled.hireDate).toBe('2020-01-05');
    expect(khaled.roles.sort()).toEqual(['admin', 'employee', 'hr']);
  });

  it('updates existing people and leaves blank cells unchanged', async () => {
    await person('sara@ems.com', { jobTitle: 'Engineer', roles: ['hr'] });
    const parsed = await parsePeopleWorkbook(await workbook([['SARA@ems.com', 'Sara Ahmad', '', '', '']]));
    const result = await applyPeopleImport(db, null, parsed.rows, { allowRoles: true });
    expect(result).toMatchObject({ created: 0, updated: 1 });
    const [sara] = await db.select().from(employees);
    expect(sara!.nameEn).toBe('Sara Ahmad');
    expect(sara!.jobTitle).toBe('Engineer');
    expect(sara!.roles.sort()).toEqual(['employee', 'hr']);
  });

  it('reports every bad row and saves nothing', async () => {
    const parsed = await parsePeopleWorkbook(
      await workbook([
        ['not-an-email', 'X', '', '', ''],
        ['a@ems.com', 'A', '', '31/02/2024', ''],
        ['b@ems.com', 'B', '', '', 'boss'],
        ['c@ems.com', 'C', '', '', ''],
        ['c@ems.com', 'C again', '', '', ''],
      ]),
    );
    expect(parsed.errors.map((e) => e.row)).toEqual([2, 3, 4, 6]);
  });

  it('rejects an unknown manager and a manager loop without saving anything', async () => {
    const unknown = await parsePeopleWorkbook(await workbook([['a@ems.com', 'A', 'ghost@ems.com', '', '']]));
    expect((await applyPeopleImport(db, null, unknown.rows, { allowRoles: true })).errors).toHaveLength(1);

    const loop = await parsePeopleWorkbook(
      await workbook([
        ['a@ems.com', 'A', 'b@ems.com', '', ''],
        ['b@ems.com', 'B', 'a@ems.com', '', ''],
      ]),
    );
    const r = await applyPeopleImport(db, null, loop.rows, { allowRoles: true });
    expect(r.errors[0]?.message).toMatch(/loop/);
    expect(await db.select().from(employees)).toHaveLength(0);
  });

  it('refuses roles when the importer is not an admin', async () => {
    const parsed = await parsePeopleWorkbook(await workbook([['a@ems.com', 'A', '', '', 'admin']]));
    const r = await applyPeopleImport(db, null, parsed.rows, { allowRoles: false });
    expect(r.errors[0]?.message).toMatch(/Only admins/);
    expect(await db.select().from(employees)).toHaveLength(0);
  });

  it('reads its own template', async () => {
    const parsed = await parsePeopleWorkbook(new Uint8Array(await buildPeopleTemplate()));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ email: 'sara@ems-itech.com', nameAr: 'سارة أحمد', hireDate: '2023-04-02' });
  });

  it('explains a missing required column', async () => {
    const parsed = await parsePeopleWorkbook(await workbook([['a@ems.com']], ['Email']));
    expect(parsed.errors[0]?.message).toMatch(/Name \(English\)/);
  });
});

describe('org chart and permissions', () => {
  it('builds the tree from managers and survives loops in old data', () => {
    const tree = buildOrgTree([
      { id: 'g', managerId: null, nameEn: 'Global' },
      { id: 't', managerId: 'g', nameEn: 'Tech' },
      { id: 'e', managerId: 't', nameEn: 'Eng' },
      { id: 'x', managerId: 'y', nameEn: 'X' },
      { id: 'y', managerId: 'x', nameEn: 'Y' },
    ]);
    expect(tree.map((n) => n.person.id)).toEqual(['g', 'x', 'y']);
    expect(tree[0]!.reports[0]!.reports[0]!.person.id).toBe('e');
  });

  it('only HR and admins manage people; only admins change settings', () => {
    expect(can({ roles: ['employee'] }, 'people.manage')).toBe(false);
    expect(can({ roles: ['employee', 'hr'] }, 'people.manage')).toBe(true);
    expect(can({ roles: ['employee', 'hr'] }, 'settings.manage')).toBe(false);
    expect(can({ roles: ['employee', 'admin'] }, 'settings.manage')).toBe(true);
    expect(can(null, 'people.manage')).toBe(false);
  });
});
