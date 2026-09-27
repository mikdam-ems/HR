import { and, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { saveDepartmentAction } from '@/app/(app)/people/actions';
import { Avatar } from '@/components/Avatar';
import { DayBadge } from '@/components/DayBadge';
import { DepartmentFields } from '@/components/DepartmentFields';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { dayEntries } from '@/db/schema';
import { isWorkday, resolveDay } from '@/domain';
import { clientLabel, getDict, localName } from '@/i18n';
import { todayISO } from '@/lib/format';
import { getDepartment } from '@/server/departments';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { currentStatus } from '@/server/profile';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const dept = await getDepartment(db, (await params).id);
  if (!dept) notFound();
  const today = todayISO();
  const ids = dept.members.map((m) => m.id);
  const [ctx, people, leaveToday] = await Promise.all([
    loadRulesContext(db),
    can(user, 'people.manage') ? listEmployees(db) : Promise.resolve([]),
    ids.length
      ? db
          .select({ employeeId: dayEntries.employeeId, leaveType: dayEntries.leaveType })
          .from(dayEntries)
          .where(and(eq(dayEntries.date, today), inArray(dayEntries.employeeId, ids)))
      : Promise.resolve([]),
  ]);
  const onLeave = new Map(leaveToday.filter((e) => e.leaveType).map((e) => [e.employeeId, e.leaveType!]));
  const members = dept.members.map((m) => ({ person: m, day: resolveDay(ctx, m.id, today), status: currentStatus(m) }));
  const working = members.filter((m) => isWorkday(m.day.dayType) && !onLeave.has(m.person.id)).length;
  const clientIds = [...new Set(members.flatMap((m) => m.day.clientIds))];
  // The head first, then everyone else by name.
  members.sort((a, b) => Number(b.person.id === dept.headId) - Number(a.person.id === dept.headId));

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <Link href="/people/departments" className="small back-link">
        <span className="flip" aria-hidden="true">←</span> {t.departments.back}
      </Link>

      <div className="bento">
        <section className="card card-dark span-8 dept-hero">
          <span className="eyebrow">{t.me.department}</span>
          <h1>{localName(locale, dept.nameEn, dept.nameAr)}</h1>
          <p className="hero-text dept-hero-desc">{dept.description ?? t.departments.noDescription}</p>
          {dept.head ? (
            <Link className="person" href={`/people/${dept.head.id}`}>
              <Avatar person={dept.head} status={currentStatus(dept.head)} />
              <span className="stack" style={{ gap: 0 }}>
                {localName(locale, dept.head.nameEn, dept.head.nameAr)}
                <span className="muted small">{t.departments.head}</span>
              </span>
            </Link>
          ) : null}
        </section>
        <div className="span-4 stack" style={{ gap: 20 }}>
          <section className="card kpi">
            <span className="label">{t.departments.team}</span>
            <strong className="kpi-value">{members.length}</strong>
            <span className="muted small">
              {t.departments.workingToday}: {working} · {t.departments.offToday}: {members.length - working}
            </span>
          </section>
          <section className="card kpi">
            <span className="label">{t.departments.clients}</span>
            <div className="row" style={{ gap: 6 }}>
              {clientIds.length
                ? clientIds.map((cid) => (
                    <Link key={cid} href={`/clients/${cid}`} className="pill pill-muted pill-link">
                      {clientLabel(locale, ctx.clients, [cid])}
                    </Link>
                  ))
                : '—'}
            </div>
          </section>
        </div>

        <section className="card span-12">
          <h2>{t.departments.team}</h2>
          {members.length ? (
            <ul className="member-grid">
              {members.map(({ person: m, day, status }) => (
                <li key={m.id}>
                  <Link href={`/people/${m.id}`} className="member-card">
                    <Avatar person={m} size="lg" status={status} />
                    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <strong>{localName(locale, m.nameEn, m.nameAr)}</strong>
                      <span className="muted small">{m.jobTitle}</span>
                      {status ? (
                        <span className="small">
                          {status.emoji} {status.text ?? t.status.presets[status.emoji as keyof typeof t.status.presets] ?? ''}
                        </span>
                      ) : null}
                      <span className="row" style={{ gap: 6, marginTop: 4 }}>
                        {onLeave.has(m.id) ? (
                          <span className="badge status-submitted">{t.timesheet.leaveTypes[onLeave.get(m.id)!]}</span>
                        ) : (
                          <DayBadge type={day.dayType} t={t} />
                        )}
                        <span className="muted small">{clientLabel(locale, ctx.clients, day.clientIds)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">{t.departments.noMembers}</span>
          )}
        </section>

        {can(user, 'people.manage') ? (
          <details className="card span-12">
            <summary className="btn btn-small" style={{ alignSelf: 'flex-start' }}>
              {t.departments.edit}
            </summary>
            <form action={saveDepartmentAction} className="stack" style={{ marginTop: 16 }}>
              <input type="hidden" name="id" value={dept.id} />
              <DepartmentFields t={t} people={people} d={dept} />
              <div>
                <button className="btn btn-primary">{t.departments.save}</button>
              </div>
            </form>
          </details>
        ) : null}
      </div>
    </>
  );
}
