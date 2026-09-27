import Link from 'next/link';
import { saveDepartmentAction } from '@/app/(app)/people/actions';
import { Flash } from '@/components/Flash';
import { PeopleTabs } from '@/components/PeopleTabs';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
import { initials } from '@/lib/format';
import { listDepartments } from '@/server/departments';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { requireUser } from '@/server/session';

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const [depts, people] = await Promise.all([listDepartments(db), listEmployees(db)]);
  const manage = can(user, 'people.manage');

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{t.departments.title}</h1>
          <span className="muted">{t.departments.intro}</span>
        </div>
        <PeopleTabs t={t} current="departments" />
      </div>

      {depts.length === 0 ? <p className="muted">{t.departments.empty}</p> : null}
      <div className="bento bento-3">
        {depts.map((d) => (
          <section key={d.id} className="card dept-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{localName(locale, d.nameEn, d.nameAr)}</h2>
              <span className="pill pill-muted">
                {d.members.length === 1 ? t.departments.memberOne : fmt(t.departments.memberCount, { count: d.members.length })}
              </span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="label">{t.departments.head}</span>
              {d.head ? (
                <Link href={`/people/${d.head.id}`}>{localName(locale, d.head.nameEn, d.head.nameAr)}</Link>
              ) : (
                <span className="muted">{t.departments.noHead}</span>
              )}
            </div>
            <div className="avatars" aria-label={t.departments.members}>
              {d.members.slice(0, 8).map((m) => (
                <Link key={m.id} href={`/people/${m.id}`} className="avatar" title={m.nameEn}>
                  {initials(m.nameEn)}
                </Link>
              ))}
            </div>
            {manage ? (
              <details>
                <summary className="btn btn-small">{t.departments.edit}</summary>
                <form action={saveDepartmentAction} className="stack" style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={d.id} />
                  <DeptFields t={t} people={people} d={d} />
                  <div>
                    <button className="btn btn-primary btn-small">{t.departments.save}</button>
                  </div>
                </form>
              </details>
            ) : null}
          </section>
        ))}
      </div>

      {manage ? (
        <form action={saveDepartmentAction} className="card">
          <h2>{t.departments.add}</h2>
          <div className="grid-form">
            <DeptFields t={t} people={people} />
          </div>
          <div>
            <button className="btn btn-primary">{t.departments.add}</button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function DeptFields({
  t,
  people,
  d,
}: {
  t: Awaited<ReturnType<typeof getDict>>['t'];
  people: { id: string; nameEn: string }[];
  d?: { id: string; nameEn: string; nameAr: string | null; headId: string | null };
}) {
  const p = d?.id ?? 'new';
  return (
    <>
      <div className="field">
        <label htmlFor={`name-${p}`}>{t.departments.name}</label>
        <input id={`name-${p}`} name="nameEn" type="text" required defaultValue={d?.nameEn} />
      </div>
      <div className="field">
        <label htmlFor={`name-ar-${p}`}>{t.departments.nameAr}</label>
        <input id={`name-ar-${p}`} name="nameAr" type="text" dir="rtl" lang="ar" defaultValue={d?.nameAr ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`head-${p}`}>{t.departments.head}</label>
        <select id={`head-${p}`} name="headId" defaultValue={d?.headId ?? ''}>
          <option value="">{t.departments.noHead}</option>
          {people.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nameEn}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
