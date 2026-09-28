import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { getDb } from '@/db';
import { daysOfMonth, isWorkday, msToMinutes, resolveDay } from '@/domain';
import { fmt, getDict, localName } from '@/i18n';
import { formatDate, formatHours, timeOfDay, todayISO } from '@/lib/format';
import { firstClockDates, monthClock } from '@/server/clock';
import { getEmployeeProfile } from '@/server/people';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';
import { canViewAttendance } from '@/server/timesheets';

function parseMonth(value: string | undefined): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return [Number(m[1]), Number(m[2])];
  const today = todayISO();
  return [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
}
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const shift = (y: number, m: number, by: number) => {
  const i = y * 12 + (m - 1) + by;
  return ym(Math.floor(i / 12), (i % 12) + 1);
};

/** Every clock in, break and clock out of a month, for the person, their manager, and HR. */
export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const person = await getEmployeeProfile(db, (await params).employeeId);
  if (!person) notFound();
  if (!canViewAttendance(user, person)) {
    return (
      <div className="flash flash-error" role="alert">
        {t.errors.forbidden}
      </div>
    );
  }
  const [year, month] = parseMonth((await searchParams).month);
  const today = todayISO();
  const [log, ctx, firsts] = await Promise.all([
    monthClock(db, person.id, year, month),
    loadRulesContext(db),
    firstClockDates(db, [person.id]),
  ]);
  // Days before they first clocked in aren't "missing": they weren't using the clock yet.
  const since = firsts[person.id] ?? '9999-12-31';

  const rows = daysOfMonth(year, month)
    .filter((d) => d <= today && d >= since)
    .reverse()
    .map((date) => {
      const day = resolveDay(ctx, person.id, date);
      const rec = log[date];
      // A session left open on an earlier day ran on until now; it counts nothing until it's corrected.
      const forgotten = !!rec?.open && date < today;
      const worked = rec && !forgotten ? msToMinutes(rec.workedMs) : 0;
      const target = isWorkday(day.dayType) ? day.expectedMinutes : 0;
      return { date, day, rec, forgotten, worked, target, over: Math.max(0, worked - target) };
    })
    .filter((r) => r.rec || isWorkday(r.day.dayType));

  const attended = rows.filter((r) => r.rec);
  const total = attended.reduce((a, r) => a + r.worked, 0);
  const overtime = attended.reduce((a, r) => a + r.over, 0);
  const starts = attended.map((r) => timeOfDay(r.rec!.firstIn)).sort();
  const usualStart = starts.length ? starts[Math.floor(starts.length / 2)] : '—';
  const own = person.id === user.id;
  const monthKey = ym(year, month);

  const result = (r: (typeof rows)[number]) => {
    // Today isn't over: show what's left, not "short" or "missing".
    if (r.date === today && r.target && r.worked < r.target) return <span className="badge">{fmt(t.attendance.toGo, { time: formatHours(r.target - r.worked, locale) })}</span>;
    if (!r.rec) return <span className="badge badge-unassigned">{t.timesheet.issues.missing_hours}</span>;
    if (r.forgotten) return <span className="badge badge-unassigned">{t.timesheet.issues.clock_open}</span>;
    if (r.rec.open) return <span className="badge status-submitted">{t.attendance.stillIn}</span>;
    if (!r.target) return <span className="badge badge-special_overtime">{fmt(t.attendance.over, { time: formatHours(r.worked, locale) })}</span>;
    if (r.over) return <span className="badge badge-special_overtime">{fmt(t.attendance.over, { time: formatHours(r.over, locale) })}</span>;
    if (r.worked >= r.target) return <span className="badge status-approved">✓ {t.attendance.fullDay}</span>;
    return <span className="badge">{fmt(t.attendance.short, { time: formatHours(r.target - r.worked, locale) })}</span>;
  };

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Avatar person={person} size="lg" />
          <div className="stack" style={{ gap: 4 }}>
            <div className="row">
              <Link className="btn btn-small" href={`?month=${shift(year, month, -1)}`} aria-label={t.timesheet.prev}>
                <span aria-hidden="true" className="flip">‹</span>
              </Link>
              <h1>{formatDate(`${monthKey}-01`, locale, { month: 'long', year: 'numeric' })}</h1>
              <Link className="btn btn-small" href={`?month=${shift(year, month, 1)}`} aria-label={t.timesheet.next}>
                <span aria-hidden="true" className="flip">›</span>
              </Link>
            </div>
            <span className="muted">
              {own ? t.attendance.title : fmt(t.attendance.titleFor, { name: localName(locale, person.nameEn, person.nameAr) })} · {t.attendance.intro}
            </span>
          </div>
        </div>
        <Link className="btn" href={`/timesheet/${person.id}?month=${monthKey}`}>
          {t.nav.timesheet}
        </Link>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="stat">
          <span className="muted small">{t.attendance.daysIn}</span>
          <strong>{attended.length}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t.attendance.total}</span>
          <strong>{formatHours(total, locale)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t.attendance.overtime}</span>
          <strong className={overtime ? 'stat-highlight' : undefined}>{formatHours(overtime, locale)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t.attendance.avgStart}</span>
          <strong dir="ltr">{usualStart}</strong>
        </div>
      </div>

      {firsts[person.id] ? (
        <p className="muted small" style={{ margin: 0 }}>
          {fmt(t.attendance.sinceFirst, { date: formatDate(firsts[person.id]!, locale) })}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="muted">{t.attendance.noRecord}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.attendance.date}</th>
                <th>{t.attendance.in}</th>
                <th>{t.attendance.out}</th>
                <th>{t.attendance.breaks}</th>
                <th>{t.attendance.worked}</th>
                <th>{t.attendance.result}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <td>
                    <strong style={{ fontWeight: 500 }}>{formatDate(r.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                    {r.rec?.events.length ? (
                      <details className="clock-events">
                        <summary className="small">{t.attendance.events}</summary>
                        <ul>
                          {r.rec.events.map((e) => (
                            <li key={e.id}>
                              <span dir="ltr">{timeOfDay(e.at)}</span> · {t.attendance.kinds[e.kind]}
                              <span className="muted"> · {t.attendance.sources[e.source as keyof typeof t.attendance.sources] ?? e.source}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                  <td dir="ltr">{r.rec ? timeOfDay(r.rec.firstIn) : '—'}</td>
                  <td dir="ltr">{r.rec?.lastOut ? timeOfDay(r.rec.lastOut) : r.rec?.open ? '…' : '—'}</td>
                  <td>{r.rec && r.rec.breakMs >= 60_000 ? formatHours(msToMinutes(r.rec.breakMs), locale) : '—'}</td>
                  <td>
                    <strong style={{ fontWeight: 600 }}>{r.rec && !r.forgotten ? formatHours(r.worked, locale) : '—'}</strong>
                    {r.target ? <span className="muted small"> / {formatHours(r.target, locale)}</span> : null}
                  </td>
                  <td>{isWorkday(r.day.dayType) || r.rec ? result(r) : <span className="badge badge-weekend">{t.attendance.dayOff}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
