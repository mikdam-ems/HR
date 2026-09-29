import Link from 'next/link';
import { closeMonthAction, remindAction, reopenMonthAction } from '@/app/(app)/reports/actions';
import { AttendanceReport } from '@/components/AttendanceReport';
import { Avatar } from '@/components/Avatar';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, formatHours, todayISO } from '@/lib/format';
import { monthAttendanceReport } from '@/server/attendance';
import { listClients } from '@/server/clients';
import { can } from '@/server/permissions';
import { monthReport } from '@/server/reports';
import { requirePermission } from '@/server/session';

const STATUSES = ['approved', 'submitted', 'returned', 'draft'] as const;
/** Groups shown as people lists: whoever still has something to do, the most actionable first. */
const PENDING = ['draft', 'returned', 'submitted'] as const;

function parseMonth(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return value!;
  // Default to last month: that's the one being closed.
  const [y, mo] = todayISO().split('-').map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requirePermission('reports.view');
  const { t, locale } = await getDict();
  const search = await searchParams;
  const month = parseMonth(search.month);
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const view = search.view === 'attendance' ? 'attendance' : 'timesheets';
  const db = await getDb();
  const [result, attendance, clientRows] = await Promise.all([
    monthReport(db, user, year, mon),
    view === 'attendance' ? monthAttendanceReport(db, user, year, mon) : null,
    listClients(db),
  ]);
  if (!result.ok || (attendance && !attendance.ok)) return <div className="flash flash-error">{t.errors.forbidden}</div>;
  const report = result.value;
  const deptFilter = search.dept ?? '';
  const clientFilter = search.client ?? '';
  const attendanceRows = (attendance?.ok ? attendance.value.rows : []).filter(
    (r) => (!deptFilter || r.department?.id === deptFilter) && (!clientFilter || r.clientIds.includes(clientFilter)),
  );
  const depts = [...new Map(report.rows.flatMap((r) => (r.department ? [[r.department.id, r.department]] : []))).values()]
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  const rows = deptFilter ? report.rows.filter((r) => r.department?.id === deptFilter) : report.rows;
  const approved = report.rows.length - report.notApproved.length;
  const byStatus = Object.fromEntries(STATUSES.map((st) => [st, report.rows.filter((r) => r.status === st)])) as Record<
    (typeof STATUSES)[number],
    typeof report.rows
  >;
  const leaveTotal = (r: (typeof report.rows)[number]) =>
    Object.entries(r.totals.leaveDaysByType)
      .map(([k, v]) => `${v} ${t.timesheet.leaveTypes[k as keyof Dict['timesheet']['leaveTypes']]}`)
      .join(', ');

  return (
    <>
      <Flash search={search} t={t} />
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{t.reports.title}</h1>
          <span className="muted">{fmt(t.reports.progress, { approved, total: report.rows.length })}</span>
        </div>
        <div className="row">
          <form className="row">
            {view === 'attendance' ? <input type="hidden" name="view" value="attendance" /> : null}
            <label htmlFor="month" className="sr-only">
              {t.reports.month}
            </label>
            <input id="month" name="month" type="month" defaultValue={month} style={{ width: 180 }} />
            <select name="dept" defaultValue={deptFilter} aria-label={t.reports.department} style={{ width: 200 }}>
              <option value="">{t.people.allDepartments}</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {localName(locale, d.nameEn, d.nameAr)}
                </option>
              ))}
            </select>
            {view === 'attendance' ? (
              <select name="client" defaultValue={clientFilter} aria-label={t.reports.client} style={{ width: 200 }}>
                <option value="">{t.people.allClients}</option>
                {clientRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localName(locale, c.nameEn, c.nameAr)}
                  </option>
                ))}
              </select>
            ) : null}
            <button className="btn">{t.reports.show}</button>
          </form>
          <a className="btn btn-primary" href={`/reports/export?month=${month}`} download>
            {t.reports.download}
          </a>
        </div>
      </div>

      <nav className="segmented segmented-light" aria-label={t.reports.title} style={{ alignSelf: 'flex-start' }}>
        <Link href={`/reports?month=${month}`} aria-current={view === 'timesheets'}>
          {t.reports.tabs.timesheets}
        </Link>
        <Link href={`/reports?view=attendance&month=${month}`} aria-current={view === 'attendance'}>
          {t.reports.tabs.attendance}
        </Link>
      </nav>

      {view === 'attendance' ? (
        <AttendanceReport rows={attendanceRows} month={month} t={t} locale={locale} />
      ) : (
        <>
          {report.closed ? (
            <div className="flash row" style={{ justifyContent: 'space-between' }}>
              <span>{fmt(t.reports.closed, { date: report.closedAt ? formatDate(report.closedAt.toISOString().slice(0, 10), locale) : '' })}</span>
              {can(user, 'settings.manage') ? (
                <form action={reopenMonthAction} className="row">
                  <input type="hidden" name="month" value={month} />
                  <span className="small">{t.reports.reopenHint}</span>
                  <button className="btn btn-small">{t.reports.reopen}</button>
                </form>
              ) : null}
            </div>
          ) : can(user, 'months.close') && report.rows.length ? (
            <section className="card close-card" aria-labelledby="close-title">
              <div className="close-head">
                <div className="stack" style={{ gap: 4 }}>
                  <h2 id="close-title">{t.reports.closeTitle}</h2>
                  <span className="muted small">{report.notApproved.length ? t.reports.closeHint : t.reports.allApproved}</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {report.notApproved.some((r) => r.status === 'draft' || r.status === 'returned') ? (
                    <form action={remindAction} title={t.reports.remindHint}>
                      <input type="hidden" name="month" value={month} />
                      <button className="btn">{t.reports.remind}</button>
                    </form>
                  ) : null}
                  <form action={closeMonthAction}>
                    <input type="hidden" name="month" value={month} />
                    <button className="btn btn-primary" disabled={report.notApproved.length > 0}>
                      {t.reports.close}
                    </button>
                  </form>
                </div>
              </div>

              <div className="close-progress" role="img" aria-label={fmt(t.reports.progress, { approved, total: report.rows.length })}>
                {STATUSES.map((st) =>
                  byStatus[st].length ? (
                    <span key={st} className={`close-seg seg-${st}`} style={{ flexGrow: byStatus[st].length }} />
                  ) : null,
                )}
              </div>
              <ul className="close-legend">
                {STATUSES.map((st) => (
                  <li key={st} className={byStatus[st].length ? undefined : 'muted'}>
                    <span className={`close-dot seg-${st}`} aria-hidden="true" />
                    {t.reports.groups[st]} <strong>{byStatus[st].length}</strong>
                  </li>
                ))}
              </ul>

              {PENDING.filter((st) => byStatus[st].length).map((st) => (
                <details key={st} className="close-group" open>
                  <summary>
                    <span className={`close-dot seg-${st}`} aria-hidden="true" />
                    {t.reports.groups[st]} <span className="muted">· {byStatus[st].length}</span>
                  </summary>
                  <ul className="close-people">
                    {byStatus[st].map((r) => (
                      <li key={r.employee.id}>
                        <Link className="person" href={`/timesheet/${r.employee.id}?month=${month}`}>
                          <Avatar person={r.employee} size="sm" />
                          <span className="stack" style={{ gap: 0 }}>
                            {localName(locale, r.employee.nameEn, r.employee.nameAr)}
                            <span className="muted small">
                              {st === 'submitted' && r.manager
                                ? fmt(t.reports.withManager, { name: localName(locale, r.manager.nameEn, r.manager.nameAr) })
                                : r.department
                                  ? localName(locale, r.department.nameEn, r.department.nameAr)
                                  : r.employee.jobTitle ?? ''}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.reports.employee}</th>
                  <th>{t.reports.client}</th>
                  <th>{t.reports.status}</th>
                  <th>{t.reports.days}</th>
                  <th>{t.reports.worked}</th>
                  <th>{t.reports.overtime}</th>
                  <th>{t.reports.weighted}</th>
                  <th>{t.reports.leave}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      {t.reports.none}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const tt = r.totals;
                    const ot = tt.regularOvertimeMinutes + tt.specialOvertimeMinutes + tt.offDayOvertimeMinutes;
                    return (
                      <tr key={r.employee.id}>
                        <td>
                          <Link href={`/timesheet/${r.employee.id}?month=${month}`}>{localName(locale, r.employee.nameEn, r.employee.nameAr)}</Link>
                          {r.department ? (
                            <div className="muted small">{localName(locale, r.department.nameEn, r.department.nameAr)}</div>
                          ) : null}
                        </td>
                        <td>{r.clients.join(', ')}</td>
                        <td>
                          <span className={`badge status-${r.status}`}>{t.timesheet.status[r.status]}</span>
                        </td>
                        <td>{tt.workingDays}</td>
                        <td>
                          {formatHours(tt.workedMinutes, locale)} <span className="muted small">/ {formatHours(tt.expectedMinutes, locale)}</span>
                        </td>
                        <td>{ot ? formatHours(ot, locale) : '—'}</td>
                        <td>{tt.weightedOvertimeMinutes ? formatHours(Math.round(tt.weightedOvertimeMinutes), locale) : '—'}</td>
                        <td className="small">{leaveTotal(r) || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <span className="muted small">{t.reports.frozenNote}</span>
        </>
      )}
    </>
  );
}
