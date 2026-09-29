import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { LATE_GRACE_MINUTES, type WorkPlace } from '@/domain';
import { fmt, localName, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatHours } from '@/lib/format';
import type { AttendanceRow } from '@/server/attendance';

const PLACES: WorkPlace[] = ['office', 'client_site', 'remote'];

/** The month's attendance per person: days in, late, absent, forgotten clock-outs and where they worked. */
export function AttendanceReport({ rows, month, t, locale }: { rows: AttendanceRow[]; month: string; t: Dict; locale: Locale }) {
  const a = t.reports.attendance;
  return (
    <>
      <p className="muted small">{fmt(a.intro, { grace: String(LATE_GRACE_MINUTES) })}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t.reports.employee}</th>
              <th>{a.daysIn}</th>
              <th>{a.late}</th>
              <th>{a.absent}</th>
              <th>{a.forgot}</th>
              <th>{a.places}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {a.none}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const tt = r.totals;
                return (
                  <tr key={r.employee.id}>
                    <td>
                      <Link className="person" href={`/attendance/${r.employee.id}?month=${month}`}>
                        <Avatar person={r.employee} size="sm" />
                        <span className="stack" style={{ gap: 0 }}>
                          {localName(locale, r.employee.nameEn, r.employee.nameAr)}
                          <span className="muted small">
                            {r.department ? localName(locale, r.department.nameEn, r.department.nameAr) : r.employee.jobTitle}
                          </span>
                        </span>
                      </Link>
                    </td>
                    {r.onClock ? (
                      <>
                        <td>{tt.daysIn}</td>
                        <td>
                          {tt.lateDays ? (
                            <span className="presence presence-late">
                              {fmt(a.lateDetail, { days: String(tt.lateDays), time: formatHours(tt.lateMinutes, locale) })}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{tt.absentDays ? <span className="presence presence-absent">{tt.absentDays}</span> : <span className="muted">—</span>}</td>
                        <td>{tt.forgotOut ? <span className="presence presence-break">{tt.forgotOut}</span> : <span className="muted">—</span>}</td>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            {PLACES.filter((p) => tt.places[p]).map((p) => (
                              <span key={p} className="where-chip">
                                {t.clock.locations[p]} · {tt.places[p]}
                              </span>
                            ))}
                            {PLACES.every((p) => !tt.places[p]) ? <span className="muted">—</span> : null}
                          </span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="muted small">
                        {a.notOnClock}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
