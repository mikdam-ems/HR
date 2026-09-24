import { EmployeeForm } from '@/components/EmployeeForm';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { getDict } from '@/i18n';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { requirePermission } from '@/server/session';

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requirePermission('people.manage');
  const { t } = await getDict();
  const managers = await listEmployees(await getDb());
  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{t.form.newPerson}</h1>
      <EmployeeForm t={t} managers={managers} canEditRoles={can(user, 'settings.manage')} />
    </>
  );
}
