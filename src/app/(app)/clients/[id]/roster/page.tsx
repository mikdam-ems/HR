import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { addDays, weekdayOf, type RosterCell } from '@/domain';
import { fmt, getDict, localName } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, todayISO } from '@/lib/format';
import { getClientProfile } from '@/server/clients';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { requireUser } from '@/server/session';
import { weekRoster } from '@/server/shifts';
import { mySwaps } from '@/server/swaps';
import { cancelSwapAction, requestSwapAction, respondSwapAction } from '@/app/(app)/swaps/actions';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A client's week at a glance: who is on which shift each day, and how many people cover each shift. */
export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const today = todayISO();
  const search = await searchParams;
  const asked = search.week;
  // Weeks start on Sunday, like the EMS work week.
  const anchor = asked && ISO.test(asked) ? asked : today;
  const from = addDays(anchor, -weekdayOf(anchor));
  const id = (await params).id;
  const [profile, roster, people, swaps] = await Promise.all([
    getClientProfile(db, id, today),
    weekRoster(db, id, from),
    listEmployees(db, { includeInactive: true }),
    mySwaps(db, user.id),
  ]);
  if (!profile) notFound();
  const { client } = profile;
  const byId = new Map(people.map((p) => [p.id, p]));
  // Leave is private: only HR, the person's manager and the person see it; everyone else sees "Off".
  const seesLeave = (employeeId: string) =>
    can(user, 'people.manage') || employeeId === user.id || byId.get(employeeId)?.managerId === user.id;

  // Group people under the shift they work most this week; custom hours last.
  const groups = [...roster.shifts.map((s) => ({ id: s.id, name: s.name, hours: `${s.startTime}–${s.endTime}` })), { id: '', name: t.roster.customHours, hours: '' }]
    .map((g) => ({
      ...g,
      rows: roster.rows
        .filter((r) => mainShift(r.cells) === g.id)
        .sort((a, b) => (byId.get(a.employeeId)?.nameEn ?? '').localeCompare(byId.get(b.employeeId)?.nameEn ?? '')),
    }))
    .filter((g) => g.rows.length || roster.coverage[g.id]);
  const shiftName = new Map(roster.shifts.map((s) => [s.id, s.name]));
  // People on this client can ask a colleague here to swap a shift.
  const onThisClient = roster.rows.some((r) => r.employeeId === user.id);
  const colleagues = roster.rows
    .map((r) => byId.get(r.employeeId))
    .filter((p): p is NonNullable<typeof p> => !!p && p.active && p.id !== user.id)
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  const link = (w: string) => `/clients/${client.id}/roster?week=${w}`;

  return (
    <>
      <Flash search={search} t={t} />
      <Link href={`/clients/${client.id}`} className="small back-link">
        <span className="flip" aria-hidden="true">←</span> {localName(locale, client.nameEn, client.nameAr)}
      </Link>
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <h1>{t.roster.title}</h1>
          <span className="muted">{fmt(t.roster.week, { date: formatDate(from, locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}</span>
        </div>
        <nav className="row" style={{ gap: 8 }} aria-label={t.roster.title}>
          <Link className="btn btn-small" href={link(addDays(from, -7))}>
            <span className="flip" aria-hidden="true">←</span> {t.roster.prev}
          </Link>
          <Link className="btn btn-small" href={link(today)} aria-current={from <= today && today <= roster.days[6]! ? 'page' : undefined}>
            {t.roster.thisWeek}
          </Link>
          <Link className="btn btn-small" href={link(addDays(from, 7))}>
            {t.roster.next} <span className="flip" aria-hidden="true">→</span>
          </Link>
        </nav>
      </div>

      {roster.rows.length === 0 ? (
        <p className="muted">{t.roster.empty}</p>
      ) : (
        <div className="table-wrap roster">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.roster.person}</th>
                {roster.days.map((d) => (
                  <th key={d} scope="col" className={d === today ? 'roster-today' : undefined}>
                    <span className="stack" style={{ gap: 0 }}>
                      {formatDate(d, locale, { weekday: 'short' })}
                      <span className="muted small">{formatDate(d, locale, { day: 'numeric', month: 'short' })}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.id || 'custom'}>
                <tr className="roster-group">
                  <th scope="rowgroup" colSpan={8}>
                    {g.name}{' '}
                    {g.hours ? (
                      <span className="muted small" dir="ltr">
                        {g.hours}
                      </span>
                    ) : null}
                  </th>
                </tr>
                {g.rows.map((r) => {
                  const p = byId.get(r.employeeId);
                  return (
                    <tr key={r.employeeId}>
                      <th scope="row">
                        {p ? (
                          <Link className="person" href={`/people/${p.id}`}>
                            <Avatar person={p} size="sm" />
                            {localName(locale, p.nameEn, p.nameAr)}
                          </Link>
                        ) : null}
                      </th>
                      {r.cells.map((c, i) => (
                        <td key={roster.days[i]} className={`roster-cell roster-${cellKind(c, seesLeave(r.employeeId))}`}>
                          <Cell cell={c} own={g.id} names={shiftName} t={t} showLeave={seesLeave(r.employeeId)} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr className="roster-coverage">
                  <th scope="row" className="muted small">
                    {t.roster.coverage}
                  </th>
                  {roster.days.map((d, i) => (
                    <td key={d}>
                      <strong>{roster.coverage[g.id]?.[i] ?? 0}</strong>
                    </td>
                  ))}
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="muted small">{t.roster.privacy}</p>

      {onThisClient ? (
        <section className="card" aria-labelledby="swap">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="swap">{t.swaps.title}</h2>
            <span className="muted small">{t.swaps.hint}</span>
          </div>
          <form action={requestSwapAction} className="row" style={{ alignItems: 'flex-end' }}>
            <input type="hidden" name="back" value={link(from)} />
            <div className="field">
              <label htmlFor="swap-with">{t.swaps.colleague}</label>
              <select id="swap-with" name="colleagueId" required style={{ width: 220 }}>
                {colleagues.map((p) => (
                  <option key={p.id} value={p.id}>
                    {localName(locale, p.nameEn, p.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="swap-date">{t.swaps.date}</label>
              <input id="swap-date" name="date" type="date" required min={today} />
            </div>
            <div className="field">
              <label htmlFor="swap-note">{t.swaps.note}</label>
              <input id="swap-note" name="note" type="text" maxLength={300} style={{ width: 240 }} />
            </div>
            <button className="btn btn-primary">{t.swaps.ask}</button>
          </form>

          <h3>{t.swaps.yours}</h3>
          {swaps.length ? (
            <ul className="list-rows">
              {swaps.map((s) => {
                const mine = s.requesterId === user.id;
                const other = byId.get(mine ? s.colleagueId : s.requesterId);
                const date = formatDate(s.date, locale, { weekday: 'short', day: 'numeric', month: 'short' });
                const name = other ? localName(locale, other.nameEn, other.nameAr) : '';
                return (
                  <li key={s.id}>
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{fmt(mine ? t.swaps.youAsked : t.swaps.theyAsked, { name, date })}</span>
                      {s.note ? <span className="muted small">{s.note}</span> : null}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {!mine && s.status === 'asked' ? (
                        <>
                          <span className="badge badge-brand">{t.swaps.waitingForYou}</span>
                          {(['accept', 'decline'] as const).map((answer) => (
                            <form key={answer} action={respondSwapAction}>
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="answer" value={answer} />
                              <input type="hidden" name="back" value={link(from)} />
                              <button className={`btn btn-small${answer === 'accept' ? ' btn-primary' : ''}`}>{t.swaps[answer]}</button>
                            </form>
                          ))}
                        </>
                      ) : (
                        <span className={`badge ${s.status === 'approved' ? 'status-approved' : 'status-submitted'}`}>{t.swaps.status[s.status]}</span>
                      )}
                      {mine && s.status !== 'approved' ? (
                        <form action={cancelSwapAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="back" value={link(from)} />
                          <button className="btn btn-small">{t.swaps.withdraw}</button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="muted">{t.swaps.none}</span>
          )}
        </section>
      ) : null}
    </>
  );
}

function mainShift(cells: RosterCell[]): string {
  const counts = new Map<string, number>();
  for (const c of cells) if (c.kind === 'shift') counts.set(c.shiftId ?? '', (counts.get(c.shiftId ?? '') ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

const cellKind = (c: RosterCell, showLeave: boolean) => (c.kind === 'leave' && !showLeave ? 'off' : c.kind);

function Cell({ cell, own, names, t, showLeave }: { cell: RosterCell; own: string; names: Map<string, string>; t: Dict; showLeave: boolean }) {
  switch (cell.kind) {
    case 'shift':
      // Show the shift name only when it differs from the row's usual shift; hours otherwise.
      return (
        <>
          {cell.swapped ? (
            <span className="swap-mark" title={t.roster.swapped} aria-label={t.roster.swapped}>
              ⇄{' '}
            </span>
          ) : null}
          {(cell.shiftId ?? '') !== own && cell.shiftId ? (
            <strong>{names.get(cell.shiftId) ?? ''}</strong>
          ) : (
            <span dir="ltr">
              {cell.start}–{cell.end}
            </span>
          )}
        </>
      );
    case 'leave':
      return <>{showLeave ? t.roster.leave : t.roster.off}</>;
    case 'holiday':
      return <>{t.roster.holiday}</>;
    case 'off':
      return <>{t.roster.off}</>;
    default:
      return <span className="muted">{t.roster.none}</span>;
  }
}
