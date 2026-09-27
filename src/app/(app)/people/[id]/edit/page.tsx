import { notFound } from 'next/navigation';
import { EmployeeForm } from '@/components/EmployeeForm';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { fmt, getDict } from '@/i18n';
import { getEmployeeProfile, listEmployees } from '@/server/people';
import { listDepartments } from '@/server/departments';
import { can } from '@/server/permissions';
import { requirePermission } from '@/server/session';

export default async function EditPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requirePermission('people.manage');
  const { t } = await getDict();
  const db = await getDb();
  const { id } = await params;
  const person = await getEmployeeProfile(db, id);
  if (!person) notFound();
  const [managers, departments] = await Promise.all([listEmployees(db), listDepartments(db)]);
  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{fmt(t.form.editPerson, { name: person.nameEn })}</h1>
      <EmployeeForm t={t} person={person} managers={managers} departments={departments} canEditRoles={can(user, 'settings.manage')} />
    </>
  );
}
