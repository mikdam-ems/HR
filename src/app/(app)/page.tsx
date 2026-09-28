import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { ClockCard } from '@/components/Clock';
import { DayBadge } from '@/components/DayBadge';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { markClientNotifiedAction } from '@/app/(app)/time-off/actions';
import { addDays, resolveDay } from '@/domain';
import { clientLabel, fmt, getDict, holidayLabel, localName, plural } from '@/i18n';
import { toClockData } from '@/lib/clockData';
import { formatDate, formatHours, timeOfDay, todayISO } from '@/lib/format';
import { clockView, teamClock } from '@/server/clock';
import { listDepartments } from '@/server/departments';
import { getEmployeeProfile, listEmployees } from '@/server/people';
import { currentStatus } from '@/server/profile';
import { can } from '@/server/permissions';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';
import { getSettings } from '@/server/settings';
import { countPendingLeave, getBalances, uninformedUpcomingLeave } from '@/server/leave';
import { countPendingApprovals, getMonth } from '@/server/timesheets';

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const today = todayISO();
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const approver = user.isManager || user.roles.includes('admin');
  const overview = can(user, 'people.manage') || can(user, 'reports.view');

  const [ctx, profile, appSettings, monthView, pendingSheets, pendingLeave, balances, depts, people, untold] = await Promise.all([
    loadRulesContext(db),
    getEmployeeProfile(db, user.id),
    getSettings(db),
    getMonth(db, user, user.id, year, month),
    approver ? countPendingApprovals(db, user) : Promise.resolve(0),
    approver ? countPendingLeave(db, user) : Promise.resolve(0),
    getBalances(db, user.id, year),
    overview ? listDepartments(db) : Promise.resolve([]),
    overview ? listEmployees(db) : Promise.resolve([]),
    uninformedUpcomingLeave(db, user.id, today),
  ]);
  const day = resolveDay(ctx, user.id, today);
  const week = Array.from({ length: 7 }, (_, i) => resolveDay(ctx, user.id, addDays(today, i + 1)));
  const pending = pendingSheets + pendingLeave;
  const annual = balances.find((b) => b.type === 'annual');
  const hint = fmt(t.dayTypeHints[day.dayType], { rate: appSettings.overtimeRates.special });
  const totals = monthView.ok ? monthView.value.summary.totals : null;
  const status = monthView.ok ? monthView.value.status : 'draft';
  const overtime = totals ? totals.regularOvertimeMinutes + totals.specialOvertimeMinutes + totals.offDayOvertimeMinutes : 0;
  const progress = totals?.expectedMinutes ? Math.min(100, Math.round((totals.workedMinutes / totals.expectedMinutes) * 100)) : 0;
  const team = (profile?.reports ?? []).filter((r) => r.active);
  const [myClock, teamNow] = await Promise.all([clockView(db, user.id), teamClock(db, team.map((r) => r.id))]);

  // Headcount by department, for HR, Finance and the General Manager.
  const headcount = [
    ...depts.map((d) => ({ id: d.id, name: localName(locale, d.nameEn, d.nameAr), count: d.members.length })),
    ...(people.some((p) => !p.departmentId)
      ? [{ id: 'none', name: t.home.noDepartment, count: people.filter((p) => !p.departmentId).length }]
      : []),
  ].filter((d) => d.count > 0);
  const maxCount = Math.max(1, ...headcount.map((d) => d.count));

  // HR sees what's missing before timesheets can be trusted.
  let setup: string[] | null = null;
  if (can(user, 'people.manage')) {
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
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">{formatDate(today, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>{fmt(t.home.hello, { name: localName(locale, user.nameEn, user.nameAr).split(' ')[0]! })}</h1>
        </div>
        <div className="row">
          <Link className="btn" href="/time-off">
            {t.timeOff.request}
          </Link>
          <Link className="btn btn-primary" href="/timesheet">
            {t.home.openTimesheet}
          </Link>
        </div>
      </div>

      {untold.map((r) => (
        <form key={r.id} action={markClientNotifiedAction} className="flash flash-info reminder">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="back" value="/" />
          <span>
            {fmt(t.timeOff.reminder, {
              client: r.clients.map((c) => localName(locale, c.nameEn, c.nameAr)).join(', '),
              dates:
                formatDate(r.fromDate, locale, { day: 'numeric', month: 'short' }) +
                (r.toDate !== r.fromDate ? ` – ${formatDate(r.toDate, locale, { day: 'numeric', month: 'short' })}` : ''),
            })}
          </span>
          <button className="btn btn-small">{t.timeOff.markInformed}</button>
        </form>
      ))}

      <div className="bento">
        <section className="card card-dark span-6" aria-labelledby="today">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow" id="today">
              {t.home.today}
            </span>
            <DayBadge type={day.dayType} t={t} holiday={holidayLabel(locale, day)} />
          </div>
          <p className="hero-text">{hint}</p>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip">
              <span className="chip-label">{t.home.client}</span>
              {clientLabel(locale, ctx.clients, [day.primaryClientId]) || t.people.none}
            </span>
            <span className="chip">
              <span className="chip-label">{t.home.hours}</span>
              {day.schedule ? (
                <bdi dir="ltr">{`${day.schedule.start}–${day.schedule.end}`}</bdi>
              ) : (
                t.home.noSchedule
              )}
            </span>
          </div>
        </section>

        <div className="span-6 clock-slot">
          <ClockCard data={toClockData(myClock, locale)} labels={t.clock} />
        </div>

        <section className="card kpi span-3">
          <span className="label">{t.home.hoursThisMonth}</span>
          <strong className="kpi-value">{formatHours(totals?.workedMinutes ?? 0, locale)}</strong>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ inlineSize: `${progress}%` }} />
          </div>
          <span className="muted small">
            {fmt(t.home.ofExpected, { hours: formatHours(totals?.expectedMinutes ?? 0, locale) })}
            {overtime ? ` · ${t.home.overtime} ${formatHours(overtime, locale)}` : ''}
          </span>
        </section>

        {approver ? (
          <section className={`card kpi span-3 ${pending ? 'card-accent' : ''}`}>
            <span className="label">{t.home.waiting}</span>
            <strong className="kpi-value">{pending}</strong>
            <Link className="btn btn-small btn-primary" href="/approvals" style={{ alignSelf: 'flex-start' }}>
              {t.home.review}
            </Link>
          </section>
        ) : (
          <section className="card kpi span-3">
            <span className="label">{t.home.leaveLeft}</span>
            <strong className="kpi-value">
              {annual?.available ?? '—'} <span className="kpi-unit">{plural(t.home.days, annual?.available ?? 0)}</span>
            </strong>
            <Link className="small" href="/time-off">
              {t.timeOff.request}
            </Link>
          </section>
        )}

        <section className="card span-12" aria-labelledby="next7">
          <h2 id="next7">{t.home.next7}</h2>
          <ol className="timeline">
            {week.map((d) => (
              <li key={d.date} className={`node node-${d.dayType}`}>
                <span className="node-dot" aria-hidden="true" />
                <strong>{formatDate(d.date, locale, { weekday: 'short' })}</strong>
                <span className="node-date">{formatDate(d.date, locale, { day: 'numeric', month: 'short' })}</span>
                <span className="node-type">{holidayLabel(locale, d) ?? t.dayTypes[d.dayType]}</span>
                {d.expectedMinutes ? <span className="muted small">{formatHours(d.expectedMinutes, locale)}</span> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="card span-6">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{fmt(t.home.timesheetCard, { month: formatDate(today, locale, { month: 'long' }) })}</h2>
            <span className={`badge status-${status}`}>{t.timesheet.status[status]}</span>
          </div>
          {approver ? (
            <div className="stack" style={{ gap: 2 }}>
              <span className="label">{t.home.leaveLeft}</span>
              <strong className="kpi-value kpi-small">
                {annual?.available ?? '—'} <span className="kpi-unit">{plural(t.home.days, annual?.available ?? 0)}</span>
              </strong>
            </div>
          ) : null}
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">{t.home.manager}</span>
            {profile?.manager ? (
              <Link className="person" href={`/people/${profile.manager.id}`}>
                <Avatar person={profile.manager} size="sm" status={currentStatus(profile.manager)} />
                {localName(locale, profile.manager.nameEn, profile.manager.nameAr)}
              </Link>
            ) : (
              <span className="muted">{t.home.noManager}</span>
            )}
          </div>
        </section>

        {team.length ? (
          <section className="card span-6">
            <h2>{t.home.team}</h2>
            <ul className="list-rows">
              {team.map((r) => (
                <li key={r.id}>
                  <Link className="person" href={`/people/${r.id}`}>
                    <Avatar person={r} size="sm" status={currentStatus(r)} />
                    <span className="stack" style={{ gap: 0 }}>
                      {localName(locale, r.nameEn, r.nameAr)}
                      <span className="muted small">
                        {currentStatus(r) ? `${currentStatus(r)!.emoji} ${currentStatus(r)!.text ?? r.jobTitle ?? ''}` : r.jobTitle}
                      </span>
                    </span>
                  </Link>
                  <span className="row" style={{ gap: 6 }}>
                    {teamNow[r.id] && teamNow[r.id]!.state !== 'out' ? (
                      <span className={`clock-pill clock-${teamNow[r.id]!.state}`}>
                        <span className="clock-dot" aria-hidden="true" />
                        {teamNow[r.id]!.state === 'break' ? t.clock.onBreak : t.clock.working}
                        {teamNow[r.id]!.since ? ` · ${timeOfDay(teamNow[r.id]!.since!)}` : ''}
                      </span>
                    ) : null}
                    <DayBadge type={resolveDay(ctx, r.id, today).dayType} t={t} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {headcount.length ? (
          <section className="card span-6" aria-labelledby="headcount">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 id="headcount">{t.home.headcount}</h2>
              <Link className="small" href="/people/departments">
                {t.people.departments}
              </Link>
            </div>
            <ul className="bars">
              {headcount.map((d) => (
                <li key={d.id}>
                  <span className="bar-label">{d.name}</span>
                  <span className="bar-track">
                    <span className="bar" style={{ inlineSize: `${(d.count / maxCount) * 100}%` }} />
                  </span>
                  <strong>{d.count}</strong>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {setup ? (
          <section className="card span-6">
            <h2>{t.home.setupTitle}</h2>
            {setup.length ? (
              <ul className="checklist">
                {setup.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              <span className="muted">{t.home.setupDone}</span>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
