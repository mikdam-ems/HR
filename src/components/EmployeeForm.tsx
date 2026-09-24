import Link from 'next/link';
import { savePersonAction } from '@/app/(app)/people/actions';
import { roleEnum, type Employee } from '@/db/schema';
import type { Dict } from '@/i18n/en';

export function EmployeeForm({
  t,
  person,
  managers,
  canEditRoles,
}: {
  t: Dict;
  person?: Employee;
  managers: Pick<Employee, 'id' | 'nameEn'>[];
  canEditRoles: boolean;
}) {
  return (
    <form action={savePersonAction} className="card">
      {person ? <input type="hidden" name="id" value={person.id} /> : null}
      <div className="grid-form">
        <div className="field">
          <label htmlFor="email">{t.form.email}</label>
          <input id="email" name="email" type="email" required defaultValue={person?.email} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="nameEn">{t.form.nameEn}</label>
          <input id="nameEn" name="nameEn" type="text" required defaultValue={person?.nameEn} />
        </div>
        <div className="field">
          <label htmlFor="nameAr">{t.form.nameAr}</label>
          <input id="nameAr" name="nameAr" type="text" dir="rtl" lang="ar" defaultValue={person?.nameAr ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="jobTitle">{t.form.jobTitle}</label>
          <input id="jobTitle" name="jobTitle" type="text" defaultValue={person?.jobTitle ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="managerId">{t.form.manager}</label>
          <select id="managerId" name="managerId" defaultValue={person?.managerId ?? ''}>
            <option value="">{t.form.noManager}</option>
            {managers
              .filter((m) => m.id !== person?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nameEn}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hireDate">{t.form.hireDate}</label>
          <input id="hireDate" name="hireDate" type="date" defaultValue={person?.hireDate ?? ''} />
        </div>
      </div>

      <fieldset className="stack" style={{ gap: 4 }} disabled={!canEditRoles}>
        <legend className="label">{t.form.roles}</legend>
        <div className="row" style={{ gap: 16 }}>
          {roleEnum.enumValues
            .filter((r) => r !== 'employee')
            .map((r) => (
              <label key={r} className="check">
                <input type="checkbox" name="roles" value={r} defaultChecked={person?.roles.includes(r)} />
                {t.roles[r]}
              </label>
            ))}
        </div>
        <span className="muted small">{t.form.rolesHint}</span>
      </fieldset>

      {person ? (
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={person.active} />
          {t.form.active}
        </label>
      ) : null}

      <div className="row">
        <button className="btn btn-primary">{person ? t.form.save : t.form.create}</button>
        <Link className="btn" href={person ? `/people/${person.id}` : '/people'}>
          {t.form.cancel}
        </Link>
      </div>
    </form>
  );
}
