import Link from 'next/link';
import { Reveal } from '@/components/Reveal';
import { saveDepartmentAction } from '@/app/(app)/people/actions';
import { Avatar } from '@/components/Avatar';
import { DepartmentFields } from '@/components/DepartmentFields';
import { Flash } from '@/components/Flash';
import { PeopleTabs } from '@/components/PeopleTabs';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
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
          <Link key={d.id} href={`/people/departments/${d.id}`} className="card dept-card card-link">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <h2>{localName(locale, d.nameEn, d.nameAr)}</h2>
              <span className="pill pill-muted">
                {fmt(t.departments.memberCount, { count: d.members.length })}
              </span>
            </div>
            <p className="muted small dept-desc">{d.description ?? t.departments.noDescription}</p>
            {d.head ? (
              <span className="person">
                <Avatar person={d.head} size="sm" />
                <span className="stack" style={{ gap: 0 }}>
                  {localName(locale, d.head.nameEn, d.head.nameAr)}
                  <span className="muted small">{t.departments.head}</span>
                </span>
              </span>
            ) : (
              <span className="muted small">
                {t.departments.head}: {t.departments.noHead}
              </span>
            )}
            <div className="avatars" aria-label={t.departments.members}>
              {d.members.slice(0, 8).map((m) => (
                <span key={m.id} className="avatar-link" title={m.nameEn}>
                  <Avatar person={m} size="sm" />
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {manage ? (
        <Reveal label={t.departments.add} cancelLabel={t.form.cancel} primary>
          <form action={saveDepartmentAction} className="card">
            <h2>{t.departments.add}</h2>
            <DepartmentFields t={t} people={people} />
            <div>
              <button className="btn btn-primary">{t.departments.add}</button>
            </div>
          </form>
        </Reveal>
      ) : null}
    </>
  );
}
