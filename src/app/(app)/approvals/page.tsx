import Link from 'next/link';
import { decideLeaveAction } from '@/app/(app)/time-off/actions';
import { decideAction } from '@/app/(app)/timesheet/actions';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { fmt, getDict, holidayLabel, localName, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, formatHours } from '@/lib/format';
import { getBalances, listPendingLeave, teamOff } from '@/server/leave';
import { requireUser } from '@/server/session';
import { getSettings } from '@/server/settings';
import { getMonth, listPendingApprovals, type MonthView } from '@/server/timesheets';

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const search = await searchParams;
  const db = await getDb();
  const [items, leaveItems, appSettings] = await Promise.all([
    listPendingApprovals(db, user),
    listPendingLeave(db, user),
    getSettings(db),
  ]);
  // One item is open at a time: a timesheet (?t=) or a leave request (?l=).
  const leave = leaveItems.find((l) => l.id === search.l) ?? (search.t || items.length ? undefined : leaveItems[0]);
  const current = leave ? undefined : (items.find((i) => i.timesheet.id === search.t) ?? items[0]);
  const total = items.length + leaveItems.length;
  const view = current ? await getMonth(db, user, current.employee.id, current.timesheet.year, current.timesheet.month) : null;
  const month = view?.ok ? view.value : null;
  const monthLabel = (y: number, m: number) =>
    formatDate(`${y}-${String(m).padStart(2, '0')}-01`, locale, { month: 'long', year: 'numeric' });
  const rate = appSettings.overtimeRates.special;

  return (
    <>
      <Flash search={search} t={t} />
      <div className="stack" style={{ gap: 4 }}>
        <h1>{t.approvals.title}</h1>
        <span className="muted">{total ? fmt(t.approvals.waiting, { count: total }) : t.approvals.none}</span>
      </div>

      {total ? (
        <div className="approvals">
          <nav className="inbox" aria-label={t.approvals.title}>
            {items.map((i) => (
              <Link key={i.timesheet.id} href={`/approvals?t=${i.timesheet.id}`} aria-current={i.timesheet.id === current?.timesheet.id}>
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{localName(locale, i.employee.nameEn, i.employee.nameAr)}</strong>
                  <span className="muted small">
                    {i.timesheet.submittedAt ? formatDate(i.timesheet.submittedAt.toISOString().slice(0, 10), locale, { day: 'numeric', month: 'short' }) : ''}
                  </span>
                </span>
                <span className="small">{monthLabel(i.timesheet.year, i.timesheet.month)}</span>
                <span className="small" style={{ fontWeight: 600, color: i.changedDays ? 'var(--special-fg)' : 'var(--brand-900)' }}>
                  {i.changedDays ? fmt(t.approvals.changedDays, { count: i.changedDays }) : t.approvals.matches}
                  {i.issues ? ` · ${fmt(t.approvals.toCheck, { count: i.issues })}` : ''}
                </span>
              </Link>
            ))}
            {leaveItems.map((l) => (
              <Link key={l.id} href={`/approvals?l=${l.id}`} aria-current={l.id === leave?.id}>
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{localName(locale, l.employee.nameEn, l.employee.nameAr)}</strong>
                  <span className="muted small">
                    {formatDate(l.createdAt.toISOString().slice(0, 10), locale, { day: 'numeric', month: 'short' })}
                  </span>
                </span>
                <span className="small">
                  {t.timesheet.leaveTypes[l.type]} · {formatDate(l.fromDate, locale, { day: 'numeric', month: 'short' })}
                  {l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate, locale, { day: 'numeric', month: 'short' })}` : ''}
                </span>
                <span className="small" style={{ fontWeight: 600, color: 'var(--leave-fg)' }}>
                  {fmt(t.timesheet.days, { n: l.daysUsed })}
                </span>
              </Link>
            ))}
          </nav>

          {leave ? <LeaveDetail leave={leave} t={t} locale={locale} /> : null}

          {current && month ? (
          <section className="card" aria-label={month.employee.nameEn}>
            <div className="page-head">
              <div className="stack" style={{ gap: 4 }}>
                <span className="muted small">
                  {monthLabel(month.year, month.month)} ·{' '}
                  {fmt(t.approvals.submitted, {
                    date: month.timesheet?.submittedAt ? formatDate(month.timesheet.submittedAt.toISOString().slice(0, 10), locale) : '',
                  })}
                </span>
                <h2>{localName(locale, month.employee.nameEn, month.employee.nameAr)}</h2>
                <span className="muted small">{month.employee.jobTitle}</span>
              </div>
              <form action={decideAction}>
                <input type="hidden" name="timesheetId" value={current.timesheet.id} />
                <input type="hidden" name="outcome" value="approve" />
                <button className="btn btn-primary">{t.approvals.approve}</button>
              </form>
            </div>

            <div className="stats">
              <Stat label={t.timesheet.workingDays} value={String(month.summary.totals.workingDays)} />
              <Stat label={t.timesheet.hoursWorked} value={formatHours(month.summary.totals.workedMinutes)} />
              <Stat
                label={t.timesheet.leave}
                value={fmt(t.timesheet.days, {
                  n: Object.values(month.summary.totals.leaveDaysByType).reduce((a, b) => a + (b ?? 0), 0),
                })}
              />
              <Stat
                label={t.timesheet.overtime}
                value={formatHours(month.summary.totals.regularOvertimeMinutes + month.summary.totals.offDayOvertimeMinutes)}
              />
              <Stat
                label={fmt(t.approvals.specialStat, { rate })}
                value={formatHours(month.summary.totals.specialOvertimeMinutes)}
              />
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <h3>{t.approvals.checked}</h3>
              {month.summary.issues.length ? (
                <ul className="issues">
                  {month.summary.issues.map((i) => (
                    <li key={`${i.date}-${i.code}`}>
                      {formatDate(i.date, locale, { day: 'numeric', month: 'short' })}: {t.timesheet.issues[i.code]}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">{t.timesheet.noIssues}</span>
              )}
            </div>

            <ChangedDays month={month} t={t} locale={locale} rate={rate} />

            <Link href={`/timesheet/${month.employee.id}?month=${month.year}-${String(month.month).padStart(2, '0')}`}>
              {t.approvals.openMonth}
            </Link>

            <form action={decideAction} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <input type="hidden" name="timesheetId" value={current.timesheet.id} />
              <input type="hidden" name="outcome" value="return" />
              <div className="field">
                <label htmlFor="note">{t.approvals.returnNote}</label>
                <textarea id="note" name="note" rows={2} required maxLength={500} />
              </div>
              <div>
                <button className="btn">{t.approvals.return}</button>
              </div>
            </form>
          </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChangedDays({
  month,
  t,
  locale,
  rate,
}: {
  month: MonthView;
  t: Dict;
  locale: Locale;
  rate: number;
}) {
  const changed = month.summary.days.filter((d) => d.changed);
  if (!changed.length) return <p className="muted" style={{ margin: 0 }}>{t.approvals.noneChanged}</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3>{fmt(t.approvals.changedTitle, { count: changed.length })}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t.approvals.date}</th>
              <th>{t.approvals.dayType}</th>
              <th>{t.approvals.expected}</th>
              <th>{t.approvals.logged}</th>
              <th>{t.approvals.countsAs}</th>
              <th>{t.approvals.note}</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((d) => {
              const o = d.totals;
              const counts = d.entry.leave
                ? { cls: d.entry.leave.type === 'sick' ? 'badge-danger' : 'status-submitted', text: `${t.timesheet.leaveTypes[d.entry.leave.type]} · ${o.leaveDays}` }
                : o.regularOvertimeMinutes
                  ? { cls: 'badge-special_overtime', text: `+${formatHours(o.regularOvertimeMinutes)} ${t.timesheet.day.regular}` }
                  : o.specialOvertimeMinutes
                    ? { cls: 'badge-special_overtime', text: `${formatHours(o.specialOvertimeMinutes)} ${fmt(t.timesheet.day.special, { rate })}` }
                    : o.offDayOvertimeMinutes
                      ? { cls: 'badge-special_overtime', text: `${formatHours(o.offDayOvertimeMinutes)} ${t.timesheet.day.offDay}` }
                      : null;
              return (
                <tr key={d.day.date}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatDate(d.day.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                  </td>
                  <td>{holidayLabel(locale, d.day) ?? t.dayTypes[d.day.dayType]}</td>
                  <td>{formatHours(d.day.expectedMinutes)}</td>
                  <td style={{ fontWeight: 600 }}>{formatHours(d.entry.workedMinutes)}</td>
                  <td>{counts ? <span className={`badge ${counts.cls}`}>{counts.text}</span> : '—'}</td>
                  <td className="muted">{month.notes[d.day.date] ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function LeaveDetail({
  leave,
  t,
  locale,
}: {
  leave: Awaited<ReturnType<typeof listPendingLeave>>[number];
  t: Dict;
  locale: Locale;
}) {
  const db = await getDb();
  const [balances, others] = await Promise.all([
    getBalances(db, leave.employeeId, Number(leave.fromDate.slice(0, 4))),
    teamOff(db, leave.employeeId, leave.fromDate, leave.toDate),
  ]);
  const balance = balances.find((b) => b.type === leave.type);
  const d = (iso: string) => formatDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <section className="card" aria-label={leave.employee.nameEn}>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">
            {t.timesheet.leaveTypes[leave.type]} · {fmt(t.timeOff.requested, { date: formatDate(leave.createdAt.toISOString().slice(0, 10), locale) })}
          </span>
          <h2>{localName(locale, leave.employee.nameEn, leave.employee.nameAr)}</h2>
          <span className="muted small">{leave.employee.jobTitle}</span>
        </div>
        <form action={decideLeaveAction}>
          <input type="hidden" name="id" value={leave.id} />
          <input type="hidden" name="outcome" value="approve" />
          <button className="btn btn-primary">{t.approvals.approve}</button>
        </form>
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <Stat label={t.timeOff.dates} value={leave.fromDate === leave.toDate ? d(leave.fromDate) : `${d(leave.fromDate)} – ${d(leave.toDate)}`} />
        <Stat label={t.timeOff.days} value={String(leave.daysUsed) + (leave.halfDay ? ` (${t.timeOff.halfDay})` : '')} />
        {balance ? (
          // Pending already includes this request, so "available" is what's left once it's approved.
          <Stat
            label={fmt(t.timeOff.afterApproval, { type: t.timesheet.leaveTypes[leave.type] })}
            value={fmt(t.timesheet.days, { n: balance.available })}
          />
        ) : (
          <Stat label={t.timeOff.statusLabel} value={t.timeOff.status.pending} />
        )}
      </div>
      {leave.note ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">{t.timeOff.note}</span>
          <span>{leave.note}</span>
        </div>
      ) : null}
      <div className="stack" style={{ gap: 6, padding: '12px 14px', borderRadius: 10, background: 'var(--bg)' }}>
        <h3>{t.timeOff.teamOff}</h3>
        {others.length ? (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {others.map((o) => (
              <li key={o.id}>
                {localName(locale, o.employee.nameEn, o.employee.nameAr)} · {d(o.fromDate)}
                {o.toDate !== o.fromDate ? ` – ${d(o.toDate)}` : ''} · {t.timeOff.status[o.status]}
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">{t.timeOff.nobodyOff}</span>
        )}
      </div>
      <form action={decideLeaveAction} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <input type="hidden" name="id" value={leave.id} />
        <input type="hidden" name="outcome" value="decline" />
        <div className="field">
          <label htmlFor="decline-note">{t.timeOff.declineNote}</label>
          <textarea id="decline-note" name="note" rows={2} maxLength={500} />
        </div>
        <div>
          <button className="btn">{t.timeOff.decline}</button>
        </div>
      </form>
    </section>
  );
}
