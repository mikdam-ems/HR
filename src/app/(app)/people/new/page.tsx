import { EmployeeForm } from '@/components/EmployeeForm';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { getDict } from '@/i18n';
import { listDepartments } from '@/server/departments';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { requirePermission } from '@/server/session';

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requirePermission('people.manage');
  const { t } = await getDict();
  const db = await getDb();
  const [managers, departments] = await Promise.all([listEmployees(db), listDepartments(db)]);
  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{t.form.newPerson}</h1>
      <EmployeeForm t={t} managers={managers} departments={departments} canEditRoles={can(user, 'settings.manage')} />
    </>
  );
}
