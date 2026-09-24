import Link from 'next/link';
import { DayBadge } from '@/components/DayBadge';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { addDays, resolveDay } from '@/domain';
import { clientLabel, fmt, getDict, holidayLabel, localName } from '@/i18n';
import { formatDate, formatHours, todayISO } from '@/lib/format';
import { getEmployeeProfile, listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';
import { getSettings } from '@/server/settings';
import { countPendingApprovals, monthStatus } from '@/server/timesheets';

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const [ctx, profile, appSettings] = await Promise.all([
    loadRulesContext(db),
    getEmployeeProfile(db, user.id),
    getSettings(db),
  ]);
  const today = todayISO();
  const day = resolveDay(ctx, user.id, today);
  const week = Array.from({ length: 7 }, (_, i) => resolveDay(ctx, user.id, addDays(today, i + 1)));
  const [status, pending] = await Promise.all([
    monthStatus(db, user.id, Number(today.slice(0, 4)), Number(today.slice(5, 7))),
    user.isManager || user.roles.includes('admin') ? countPendingApprovals(db, user) : Promise.resolve(0),
  ]);
  const hint = fmt(t.dayTypeHints[day.dayType], { rate: appSettings.overtimeRates.special });

  // HR sees what's missing before timesheets can be trusted.
  let setup: string[] | null = null;
  if (can(user, 'people.manage')) {
    const people = await listEmployees(db);
    const unassigned = people.filter((p) => resolveDay(ctx, p.id, today).dayType === 'unassigned').length;
    const noSchedule = people.filter((p) => !ctx.schedules.some((s) => s.employeeId === p.id)).length;
    setup = [
      ...(appSettings.homeCalendarId ? [] : [t.home.setupNoHome]),
      ...(unassigned ? [fmt(t.home.setupUnassigned, { count: unassigned })] : []),
      ...(noSchedule ? [fmt(t.home.setupNoSchedule, { count: noSchedule })] : []),
    ];
  }

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{fmt(t.home.hello, { name: localName(locale, user.nameEn, user.nameAr).split(' ')[0]! })}</h1>

      <section className="card" aria-labelledby="today">
        <div className="today">
          <h2 id="today">
            {t.home.today} · {formatDate(today, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <DayBadge type={day.dayType} t={t} holiday={holidayLabel(locale, day)} />
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {hint}
        </p>
        <div className="row" style={{ gap: 24 }}>
          <span>
            <span className="label">{t.home.client}: </span>
            {clientLabel(locale, ctx.clients, [day.primaryClientId]) || t.people.none}
          </span>
          <span>
            <span className="label">{t.home.hours}: </span>
            {day.schedule ? (
              <bdi dir="ltr">{`${day.schedule.start}–${day.schedule.end} (${formatHours(day.expectedMinutes || 0)})`}</bdi>
            ) : (
              t.home.noSchedule
            )}
          </span>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <h2>{fmt(t.home.timesheetCard, { month: formatDate(today, locale, { month: 'long' }) })}</h2>
            <span className={`badge status-${status}`}>{t.timesheet.status[status]}</span>
          </div>
          <Link className="btn btn-primary" href="/timesheet">
            {t.home.openTimesheet}
          </Link>
        </div>
        {pending ? (
          <Link href="/approvals">{fmt(t.home.pending, { count: pending })}</Link>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="next7">
        <h2 id="next7">{t.home.next7}</h2>
        <div className="week">
          {week.map((d) => (
            <div key={d.date} className={`week-day day-${d.dayType}`}>
              <strong>{formatDate(d.date, locale, { weekday: 'short', day: 'numeric' })}</strong>
              <span>{holidayLabel(locale, d) ?? t.dayTypes[d.dayType]}</span>
              {d.expectedMinutes ? <span>{formatHours(d.expectedMinutes)}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>{t.home.manager}</h2>
          {profile?.manager ? (
            <Link href={`/people/${profile.manager.id}`}>
              {localName(locale, profile.manager.nameEn, profile.manager.nameAr)}
            </Link>
          ) : (
            <span className="muted">{t.home.noManager}</span>
          )}
        </section>
        {profile?.reports.length ? (
          <section className="card">
            <h2>{t.home.team}</h2>
            <ul className="stack" style={{ margin: 0, paddingInlineStart: 18, gap: 6 }}>
              {profile.reports
                .filter((r) => r.active)
                .map((r) => {
                  const rd = resolveDay(ctx, r.id, today);
                  return (
                    <li key={r.id}>
                      <Link href={`/people/${r.id}`}>{localName(locale, r.nameEn, r.nameAr)}</Link>{' '}
                      <DayBadge type={rd.dayType} t={t} />
                    </li>
                  );
                })}
            </ul>
          </section>
        ) : null}
      </div>

      {setup ? (
        <section className="card">
          <h2>{t.home.setupTitle}</h2>
          {setup.length ? (
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {setup.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <span className="muted">{t.home.setupDone}</span>
          )}
        </section>
      ) : null}
    </>
  );
}
