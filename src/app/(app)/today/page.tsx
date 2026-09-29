import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { PresencePill } from '@/components/PresencePill';
import { getDb } from '@/db';
import { workLocationEnum, type WorkLocation } from '@/db/schema';
import { LATE_GRACE_MINUTES, type PresenceStatus } from '@/domain';
import { clientLabel, fmt, getDict, localName } from '@/i18n';
import { formatHours, timeOfDay } from '@/lib/format';
import { listClients } from '@/server/clients';
import { listDepartments } from '@/server/departments';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { todayBoard } from '@/server/presence';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';

/** The order of the count tiles: who's here, then who needs a look, then who isn't expected. */
const TILES: PresenceStatus[] = ['working', 'break', 'late', 'not_in', 'absent', 'on_leave', 'done', 'off'];
/** Rows needing a manager's attention come first. */
const ROW_ORDER: PresenceStatus[] = ['absent', 'late', 'not_in', 'working', 'break', 'done', 'on_leave', 'off'];

type Search = Record<string, string | undefined>;

/** Who's in right now. Managers see their team; HR, Finance and admins see everyone. */
export default async function TodayPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const everyone = can(user, 'reports.view');
  if (!everyone && !user.isManager) {
    return (
      <div className="flash flash-error" role="alert">
        {t.errors.forbidden}
      </div>
    );
  }

  const search = await searchParams;
  const clientFilter = search.client ?? '';
  const deptFilter = search.dept ?? '';
  const whereFilter = workLocationEnum.enumValues.includes(search.where as WorkLocation) ? (search.where as WorkLocation) : '';
  const statusFilter = TILES.includes(search.status as PresenceStatus) ? (search.status as PresenceStatus) : '';

  const db = await getDb();
  const [people, ctx, clientRows, deptRows] = await Promise.all([listEmployees(db), loadRulesContext(db), listClients(db), listDepartments(db)]);
  const scope = everyone ? people : people.filter((p) => p.managerId === user.id);
  const now = new Date();
  const board = await todayBoard(db, scope, now);

  const filtered = board.filter(
    (r) =>
      (!clientFilter || r.day.clientIds.includes(clientFilter)) &&
      (!deptFilter || r.employee.departmentId === deptFilter) &&
      (!whereFilter || r.location === whereFilter),
  );
  const counts = Object.fromEntries(TILES.map((s) => [s, filtered.filter((r) => r.presence.status === s).length]));
  const shown = filtered
    .filter((r) => !statusFilter || r.presence.status === statusFilter)
    .sort((a, b) => ROW_ORDER.indexOf(a.presence.status) - ROW_ORDER.indexOf(b.presence.status));

  const withStatus = (status: PresenceStatus | '') => {
    const q = new URLSearchParams({
      ...(clientFilter ? { client: clientFilter } : {}),
      ...(deptFilter ? { dept: deptFilter } : {}),
      ...(whereFilter ? { where: whereFilter } : {}),
      ...(status ? { status } : {}),
    }).toString();
    return q ? `/today?${q}` : '/today';
  };

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{t.today.title}</h1>
          <span className="muted">
            {everyone ? t.today.introAll : t.today.introTeam} · <bdi dir="ltr">{fmt(t.today.asOf, { time: timeOfDay(now) })}</bdi>
          </span>
        </div>
      </div>

      <form className="row" role="search">
        {statusFilter ? <input type="hidden" name="status" value={statusFilter} /> : null}
        <select name="client" defaultValue={clientFilter} aria-label={t.today.client} style={{ width: 200 }}>
          <option value="">{t.people.allClients}</option>
          {clientRows.map((c) => (
            <option key={c.id} value={c.id}>
              {localName(locale, c.nameEn, c.nameAr)}
            </option>
          ))}
        </select>
        <select name="dept" defaultValue={deptFilter} aria-label={t.people.department} style={{ width: 200 }}>
          <option value="">{t.people.allDepartments}</option>
          {deptRows.map((d) => (
            <option key={d.id} value={d.id}>
              {localName(locale, d.nameEn, d.nameAr)}
            </option>
          ))}
        </select>
        <select name="where" defaultValue={whereFilter} aria-label={t.today.where} style={{ width: 170 }}>
          <option value="">{t.today.anywhere}</option>
          {workLocationEnum.enumValues.map((w) => (
            <option key={w} value={w}>
              {t.clock.locations[w]}
            </option>
          ))}
        </select>
        <button className="btn">{t.people.filter}</button>
      </form>

      <nav className="presence-tiles" aria-label={t.today.title}>
        {TILES.map((s) => (
          <Link
            key={s}
            href={withStatus(statusFilter === s ? '' : s)}
            className={`presence-tile presence-tile-${s}`}
            aria-current={statusFilter === s ? 'true' : undefined}
          >
            <strong>{counts[s]}</strong>
            <span>{t.today.status[s]}</span>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="muted">
          {t.today.empty}{' '}
          {statusFilter || clientFilter || deptFilter || whereFilter ? <Link href="/today">{t.today.everyone}</Link> : null}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.today.person}</th>
                <th>{t.today.now}</th>
                <th>{t.today.where}</th>
                <th>{t.today.client}</th>
                <th>{t.today.shift}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.employee.id}>
                  <td>
                    <Link className="person" href={`/people/${r.employee.id}`}>
                      <Avatar person={r.employee} size="sm" />
                      <span className="stack" style={{ gap: 0 }}>
                        {localName(locale, r.employee.nameEn, r.employee.nameAr)}
                        <span className="muted small">{r.employee.jobTitle}</span>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <PresencePill row={r} t={t} locale={locale} />
                      {r.presence.lateBy && r.presence.status !== 'late' ? (
                        <span className="small late-note">{fmt(t.today.cameLate, { time: formatHours(r.presence.lateBy, locale) })}</span>
                      ) : null}
                    </span>
                  </td>
                  <td>{r.location ? <span className="where-chip">{t.clock.locations[r.location]}</span> : <span className="muted">—</span>}</td>
                  <td>{clientLabel(locale, ctx.clients, r.day.clientIds) || <span className="muted">—</span>}</td>
                  <td>
                    {r.day.schedule && r.day.expectedMinutes ? (
                      <bdi dir="ltr">{`${r.day.schedule.start}–${r.day.schedule.end}`}</bdi>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{fmt(t.today.rules, { grace: String(LATE_GRACE_MINUTES) })}</p>
    </>
  );
}
