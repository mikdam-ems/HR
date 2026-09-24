import Link from 'next/link';
import { closeMonthAction, reopenMonthAction } from '@/app/(app)/reports/actions';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, formatHours, todayISO } from '@/lib/format';
import { can } from '@/server/permissions';
import { monthReport } from '@/server/reports';
import { requirePermission } from '@/server/session';

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
  const result = await monthReport(await getDb(), user, year, mon);
  if (!result.ok) return <div className="flash flash-error">{t.errors.forbidden}</div>;
  const report = result.value;
  const approved = report.rows.length - report.notApproved.length;
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
            <label htmlFor="month" className="sr-only">
              {t.reports.month}
            </label>
            <input id="month" name="month" type="month" defaultValue={month} style={{ width: 180 }} />
            <button className="btn">{t.reports.show}</button>
          </form>
          <a className="btn btn-primary" href={`/reports/export?month=${month}`} download>
            {t.reports.download}
          </a>
        </div>
      </div>

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
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{t.reports.closeHint}</span>
            <form action={closeMonthAction}>
              <input type="hidden" name="month" value={month} />
              <button className="btn btn-primary" disabled={report.notApproved.length > 0}>
                {t.reports.close}
              </button>
            </form>
          </div>
          {report.notApproved.length ? (
            <span className="small">
              <strong>{t.reports.waitingFor}</strong>{' '}
              {report.notApproved.map((r, i) => (
                <span key={r.employee.id}>
                  {i ? ', ' : ''}
                  {localName(locale, r.employee.nameEn, r.employee.nameAr)} ({t.timesheet.status[r.status]})
                </span>
              ))}
            </span>
          ) : null}
        </div>
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
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  {t.reports.none}
                </td>
              </tr>
            ) : (
              report.rows.map((r) => {
                const tt = r.totals;
                const ot = tt.regularOvertimeMinutes + tt.specialOvertimeMinutes + tt.offDayOvertimeMinutes;
                return (
                  <tr key={r.employee.id}>
                    <td>
                      <Link href={`/timesheet/${r.employee.id}?month=${month}`}>{localName(locale, r.employee.nameEn, r.employee.nameAr)}</Link>
                    </td>
                    <td>{r.clients.join(', ')}</td>
                    <td>
                      <span className={`badge status-${r.status}`}>{t.timesheet.status[r.status]}</span>
                    </td>
                    <td>{tt.workingDays}</td>
                    <td>
                      {formatHours(tt.workedMinutes)} <span className="muted small">/ {formatHours(tt.expectedMinutes)}</span>
                    </td>
                    <td>{ot ? formatHours(ot) : '—'}</td>
                    <td>{tt.weightedOvertimeMinutes ? formatHours(Math.round(tt.weightedOvertimeMinutes)) : '—'}</td>
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
  );
}
