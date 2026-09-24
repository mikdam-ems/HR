'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { employees, type Role } from '@/db/schema';
import { bool, redirectWith, str, strs } from '@/lib/forms';
import { type ImportResult, applyPeopleImport, parsePeopleWorkbook } from '@/server/importPeople';
import {
  addAssignment,
  createEmployee,
  endAssignment,
  removeAssignment,
  removeSchedule,
  setSchedule,
  updateEmployee,
} from '@/server/people';
import { can } from '@/server/permissions';
import { requirePermission } from '@/server/session';

export async function savePersonAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const db = await getDb();
  const id = str(fd, 'id');

  // Roles are admin-only. For anyone else, keep what the person already has.
  let roles: Role[];
  if (can(actor, 'settings.manage')) {
    roles = strs(fd, 'roles') as Role[];
  } else if (id) {
    const [current] = await db.select({ roles: employees.roles }).from(employees).where(eq(employees.id, id));
    roles = current?.roles ?? ['employee'];
  } else {
    roles = ['employee'];
  }

  const input = {
    email: str(fd, 'email') ?? '',
    nameEn: str(fd, 'nameEn') ?? '',
    nameAr: str(fd, 'nameAr'),
    jobTitle: str(fd, 'jobTitle'),
    managerId: str(fd, 'managerId'),
    hireDate: str(fd, 'hireDate'),
    roles,
    active: id ? bool(fd, 'active') : true,
  };
  const result = id ? await updateEmployee(db, actor.id, id, input) : await createEmployee(db, actor.id, input);
  revalidatePath('/people');
  if (!result.ok) redirectWith(id ? `/people/${id}/edit` : '/people/new', result);
  redirect(`/people/${result.value.id}?ok=${id ? 'saved' : 'created'}`);
}

export async function addAssignmentAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const employeeId = str(fd, 'employeeId') ?? '';
  const result = await addAssignment(await getDb(), actor.id, {
    employeeId,
    clientId: str(fd, 'clientId') ?? '',
    startDate: str(fd, 'startDate') ?? '',
    endDate: str(fd, 'endDate'),
    primary: bool(fd, 'primary'),
  });
  revalidatePath(`/people/${employeeId}`);
  redirectWith(`/people/${employeeId}`, result, 'created');
}

export async function endAssignmentAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const employeeId = str(fd, 'employeeId') ?? '';
  const result = await endAssignment(await getDb(), actor.id, str(fd, 'id') ?? '', str(fd, 'endDate') ?? '');
  redirectWith(`/people/${employeeId}`, result);
}

export async function removeAssignmentAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const employeeId = str(fd, 'employeeId') ?? '';
  const result = await removeAssignment(await getDb(), actor.id, str(fd, 'id') ?? '');
  redirectWith(`/people/${employeeId}`, result, 'removed');
}

export async function setScheduleAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const employeeId = str(fd, 'employeeId') ?? '';
  const result = await setSchedule(await getDb(), actor.id, {
    employeeId,
    effectiveFrom: str(fd, 'effectiveFrom') ?? '',
    startTime: str(fd, 'startTime') ?? '',
    endTime: str(fd, 'endTime') ?? '',
    breakMinutes: Number(str(fd, 'breakMinutes') ?? 0),
    shiftCode: str(fd, 'shiftCode'),
  });
  redirectWith(`/people/${employeeId}`, result);
}

export async function removeScheduleAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const employeeId = str(fd, 'employeeId') ?? '';
  const result = await removeSchedule(await getDb(), actor.id, str(fd, 'id') ?? '');
  redirectWith(`/people/${employeeId}`, result, 'removed');
}

export async function importPeopleAction(_prev: ImportResult | null, fd: FormData): Promise<ImportResult> {
  const actor = await requirePermission('people.manage');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { created: 0, updated: 0, errors: [{ row: null, message: 'Choose an .xlsx file.' }] };
  }
  const parsed = await parsePeopleWorkbook(new Uint8Array(await file.arrayBuffer()));
  if (parsed.errors.length) return { created: 0, updated: 0, errors: parsed.errors };
  const result = await applyPeopleImport(await getDb(), actor.id, parsed.rows, {
    allowRoles: can(actor, 'settings.manage'),
  });
  revalidatePath('/people');
  return result;
}
