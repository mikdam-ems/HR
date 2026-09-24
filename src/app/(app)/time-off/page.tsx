import { cancelLeaveAction, requestLeaveAction } from '@/app/(app)/time-off/actions';
import { Balances } from '@/components/Balances';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { leaveTypeEnum } from '@/db/schema';
import { isWorkday } from '@/domain';
import { fmt, getDict, holidayLabel } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, todayISO } from '@/lib/format';
import { getBalances, listRequests, previewRequest } from '@/server/leave';
import { requireUser } from '@/server/session';

type LeaveType = (typeof leaveTypeEnum.enumValues)[number];

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const search = await searchParams;
  const db = await getDb();
  const today = todayISO();
  const year = Number(today.slice(0, 4));

  const type = (leaveTypeEnum.enumValues as readonly string[]).includes(search.type ?? '') ? (search.type as LeaveType) : 'annual';
  const from = search.from ?? '';
  const to = search.to || from;
  const halfDay = search.halfDay === 'on';
  const note = search.note ?? '';

  const [balances, requests, preview] = await Promise.all([
    getBalances(db, user.id, year),
    listRequests(db, user.id),
    from ? previewRequest(db, user.id, { type, fromDate: from, toDate: to, halfDay, note }) : Promise.resolve(null),
  ]);
  const range = (a: string, b: string) =>
    a === b
      ? formatDate(a, locale, { weekday: 'short', day: 'numeric', month: 'short' })
      : `${formatDate(a, locale, { day: 'numeric', month: 'short' })} – ${formatDate(b, locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <>
      <Flash search={search} t={t} />
      <h1>{t.timeOff.title}</h1>

      <section className="stack">
        <h2>{fmt(t.timeOff.year, { year })}</h2>
        <Balances balances={balances} t={t} />
      </section>

      <section className="card">
        <h2>{t.timeOff.request}</h2>
        {/* Step 1 is a plain GET so the page can show exactly what the request would use before sending. */}
        <form method="get" className="stack">
          <div className="grid-form">
            <div className="field">
              <label htmlFor="type">{t.timeOff.type}</label>
              <select id="type" name="type" defaultValue={type}>
                {leaveTypeEnum.enumValues.map((l) => (
                  <option key={l} value={l}>
                    {t.timesheet.leaveTypes[l]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="from">{t.timeOff.from}</label>
              <input id="from" name="from" type="date" required defaultValue={from} />
            </div>
            <div className="field">
              <label htmlFor="to">{t.timeOff.to}</label>
              <input id="to" name="to" type="date" defaultValue={search.to ?? ''} />
            </div>
            <label className="check">
              <input type="checkbox" name="halfDay" defaultChecked={halfDay} />
              {t.timeOff.halfDay}
            </label>
          </div>
          <div className="field">
            <label htmlFor="note">{t.timeOff.note}</label>
            <textarea id="note" name="note" rows={2} maxLength={500} defaultValue={note} />
          </div>
          <div>
            <button className="btn">{t.timeOff.check}</button>
          </div>
        </form>

        {preview && !preview.ok ? (
          <div className="flash flash-error" role="alert">
            {t.errors[preview.error as keyof Dict['errors']] ?? t.errors.invalid_input}
            {preview.detail ? <span className="small"> ({preview.detail})</span> : null}
          </div>
        ) : null}

        {preview?.ok ? (
          <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <h3>
              {t.timesheet.leaveTypes[type]} · {range(from, to)}
            </h3>
            <strong style={{ fontSize: 18 }}>{fmt(t.timeOff.uses, { n: preview.value.daysUsed })}</strong>
            {preview.value.days.some((d) => !isWorkday(d.dayType)) ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="label">{t.timeOff.notCounted}</span>
                <div className="preview-days">
                  {preview.value.days
                    .filter((d) => !isWorkday(d.dayType))
                    .map((d) => (
                      <span key={d.date} className={`badge badge-${d.dayType}`}>
                        {formatDate(d.date, locale, { weekday: 'short', day: 'numeric' })} · {holidayLabel(locale, d) ?? t.dayTypes[d.dayType]}
                      </span>
                    ))}
                </div>
              </div>
            ) : null}
            {preview.value.balanceAfter !== null ? (
              <span className={preview.value.balanceAfter < 0 ? 'negative' : 'muted'}>
                {fmt(type === 'sick' ? t.timeOff.sickBalanceAfter : t.timeOff.balanceAfter, { n: preview.value.balanceAfter })}
              </span>
            ) : null}
            {type === 'sick' && preview.value.balanceAfter !== null && preview.value.balanceAfter < 0 ? (
              <span className="muted small">{t.timeOff.overSick}</span>
            ) : null}
            <form action={requestLeaveAction}>
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              {halfDay ? <input type="hidden" name="halfDay" value="on" /> : null}
              <input type="hidden" name="note" value={note} />
              <button className="btn btn-primary">{t.timeOff.send}</button>
            </form>
          </div>
        ) : null}
      </section>

      <section className="stack">
        <h2>{t.timeOff.myRequests}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.timeOff.type}</th>
                <th>{t.timeOff.dates}</th>
                <th>{t.timeOff.days}</th>
                <th>{t.timeOff.statusLabel}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {t.timeOff.none}
                  </td>
                </tr>
              ) : (
                requests.map((r) => {
                  const cancellable = r.status === 'pending' || (r.status === 'approved' && r.fromDate > today);
                  return (
                    <tr key={r.id}>
                      <td>{t.timesheet.leaveTypes[r.type]}</td>
                      <td>
                        {range(r.fromDate, r.toDate)}
                        {r.note ? <div className="muted small">{r.note}</div> : null}
                      </td>
                      <td>{r.daysUsed}</td>
                      <td>
                        <span className={`badge status-${r.status}`}>{t.timeOff.status[r.status]}</span>
                        {r.managerNote ? (
                          <div className="muted small">
                            {t.timeOff.managerSaid} {r.managerNote}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {cancellable ? (
                          <form action={cancelLeaveAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="btn btn-small btn-danger">{t.timeOff.cancel}</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
