import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { StatusLine } from '@/components/StatusLine';
import { EmsLogo } from '@/components/EmsLogo';
import { DayBadge } from '@/components/DayBadge';
import { Flash } from '@/components/Flash';
import { PeopleTabs } from '@/components/PeopleTabs';
import { getDb } from '@/db';
import type { Employee } from '@/db/schema';
import { resolveDay, type ResolvedDay } from '@/domain';
import { clientLabel, fmt, getDict, localName, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { todayISO } from '@/lib/format';
import { listClients } from '@/server/clients';
import { listDepartments } from '@/server/departments';
import { buildOrgTree, type OrgNode } from '@/server/orgTree';
import { listEmployees } from '@/server/people';
import { currentStatus } from '@/server/profile';
import { can } from '@/server/permissions';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';

type Search = Record<string, string | undefined>;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const search = await searchParams;
  const view = search.view === 'chart' ? 'chart' : 'list';
  const layout = search.layout === 'outline' ? 'outline' : 'pyramid';
  const q = (search.q ?? '').trim().toLowerCase();
  const clientFilter = search.client ?? '';
  const deptFilter = search.dept ?? '';

  const db = await getDb();
  const [people, ctx, clientRows, deptRows] = await Promise.all([
    listEmployees(db),
    loadRulesContext(db),
    listClients(db),
    listDepartments(db),
  ]);
  const deptName = new Map(deptRows.map((d) => [d.id, localName(locale, d.nameEn, d.nameAr)]));
  const today = todayISO();
  const days = new Map(people.map((p) => [p.id, resolveDay(ctx, p.id, today)]));
  const byId = new Map(people.map((p) => [p.id, p]));

  const shown = people.filter((p) => {
    const matchesText =
      !q || [p.nameEn, p.nameAr ?? '', p.email, p.jobTitle ?? ''].some((s) => s.toLowerCase().includes(q));
    const matchesClient = !clientFilter || days.get(p.id)!.clientIds.includes(clientFilter);
    const matchesDept = !deptFilter || p.departmentId === deptFilter;
    return matchesText && matchesClient && matchesDept;
  });

  const query = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(clientFilter ? { client: clientFilter } : {}),
    ...(deptFilter ? { dept: deptFilter } : {}),
  }).toString();

  return (
    <>
      <Flash search={search} t={t} />
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{t.people.title}</h1>
          <span className="muted">{fmt(t.people.count, { count: shown.length })}</span>
        </div>
        {can(user, 'people.manage') ? (
          <div className="row">
            <Link className="btn" href="/people/import">
              {t.people.import}
            </Link>
            <Link className="btn btn-primary" href="/people/new">
              {t.people.add}
            </Link>
          </div>
        ) : null}
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <form className="row" role="search">
          <input type="hidden" name="view" value={view} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t.people.search}
            aria-label={t.people.search}
            style={{ width: 260 }}
          />
          <select name="client" defaultValue={clientFilter} aria-label={t.people.currentClient} style={{ width: 200 }}>
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
          <button className="btn">{t.people.filter}</button>
        </form>
        <PeopleTabs t={t} current={view} query={query} />
      </div>

      {view === 'chart' ? (
        <>
          <nav className="segmented segmented-light" aria-label={t.people.chart} style={{ alignSelf: 'flex-start' }}>
            <Link href={`/people?view=chart&layout=pyramid${query ? `&${query}` : ''}`} aria-current={layout === 'pyramid'}>
              {t.people.pyramid}
            </Link>
            <Link href={`/people?view=chart&layout=outline${query ? `&${query}` : ''}`} aria-current={layout === 'outline'}>
              {t.people.outline}
            </Link>
          </nav>
          {layout === 'pyramid' ? (
            <div className="pyramid-wrap">
              <ul className="pyramid" aria-label={t.people.chart}>
                {buildOrgTree(shown).map((n) => (
                  <PyramidItem key={n.person.id} node={n} deptName={deptName} locale={locale} presets={t.status.presets} root />
                ))}
              </ul>
            </div>
          ) : (
            <ul className="org" aria-label={t.people.chart}>
              {buildOrgTree(shown).map((n) => (
                <OrgItem key={n.person.id} node={n} days={days} ctxClients={ctx.clients} deptName={deptName} locale={locale} t={t} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.people.name}</th>
                <th>{t.people.jobTitle}</th>
                <th>{t.people.department}</th>
                <th>{t.people.manager}</th>
                <th>{t.people.currentClient}</th>
                <th>{t.people.today}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {t.people.empty}
                  </td>
                </tr>
              ) : (
                shown.map((p) => {
                  const d = days.get(p.id)!;
                  const manager = p.managerId ? byId.get(p.managerId) : undefined;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link className="person" href={`/people/${p.id}`}>
                          <Avatar person={p} size="sm" status={currentStatus(p)} />
                          <span className="stack" style={{ gap: 0 }}>
                            {localName(locale, p.nameEn, p.nameAr)}
                            <span className="muted small">{p.email}</span>
                            <StatusLine status={currentStatus(p)} presets={t.status.presets} />
                          </span>
                        </Link>
                      </td>
                      <td>{p.jobTitle ?? t.people.none}</td>
                      <td>{(p.departmentId && deptName.get(p.departmentId)) || t.people.none}</td>
                      <td>{manager ? localName(locale, manager.nameEn, manager.nameAr) : t.people.none}</td>
                      <td>
                        {d.clientIds.length
                          ? d.clientIds.map((cid, i) => (
                              <span key={cid}>
                                {i ? ', ' : ''}
                                <Link href={`/clients/${cid}`}>{clientLabel(locale, ctx.clients, [cid])}</Link>
                              </span>
                            ))
                          : t.people.none}
                      </td>
                      <td>
                        <DayBadge type={d.dayType} t={t} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function clientNames(d: ResolvedDay, clients: Record<string, { name: string; nameAr?: string }>, locale: Locale) {
  return clientLabel(locale, clients, d.clientIds);
}

function OrgItem({
  node,
  days,
  ctxClients,
  deptName,
  locale,
  t,
}: {
  node: OrgNode<Employee>;
  days: Map<string, ResolvedDay>;
  ctxClients: Record<string, { name: string; nameAr?: string }>;
  deptName: Map<string, string>;
  locale: Locale;
  t: Dict;
}) {
  const p = node.person;
  const d = days.get(p.id)!;
  return (
    <li>
      <Link className="org-card" href={`/people/${p.id}`}>
        <Avatar person={p} status={currentStatus(p)} />
        <span className="stack" style={{ gap: 0 }}>
          <strong style={{ fontWeight: 600 }}>{localName(locale, p.nameEn, p.nameAr)}</strong>
          <span className="muted small">
            {[p.jobTitle, p.departmentId && deptName.get(p.departmentId), clientNames(d, ctxClients, locale)].filter(Boolean).join(' · ') || t.people.none}
          </span>
          <StatusLine status={currentStatus(p)} presets={t.status.presets} />
        </span>
      </Link>
      {node.reports.length ? (
        <ul>
          {node.reports.map((c) => (
            <OrgItem key={c.person.id} node={c} days={days} ctxClients={ctxClients} deptName={deptName} locale={locale} t={t} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Top-down org chart. A manager whose reports have no reports of their own shows them as a
 * vertical stack, so wide teams don't make the chart impossibly wide.
 */
function PyramidItem({
  node,
  deptName,
  locale,
  presets,
  root = false,
}: {
  node: OrgNode<Employee>;
  deptName: Map<string, string>;
  locale: Locale;
  presets: Record<string, string>;
  root?: boolean;
}) {
  const p = node.person;
  const leaves = node.reports.length > 1 && node.reports.every((r) => r.reports.length === 0);
  const status = currentStatus(p);
  return (
    <li>
      <Link className="pyr-card" href={`/people/${p.id}`}>
        {root ? <EmsLogo variant="white" /> : null}
        <Avatar person={p} size="lg" status={status} />
        <strong>{localName(locale, p.nameEn, p.nameAr)}</strong>
        <span className="muted small">{p.jobTitle}</span>
        <StatusLine status={status} presets={presets} />
        {p.departmentId && deptName.get(p.departmentId) ? <span className="pill pill-muted">{deptName.get(p.departmentId)}</span> : null}
        {node.reports.length ? <span className="pyr-count">{node.reports.length}</span> : null}
      </Link>
      {node.reports.length ? (
        <ul className={leaves ? 'pyr-stack' : undefined}>
          {node.reports.map((c) =>
            leaves ? (
              <li key={c.person.id}>
                <Link className="pyr-card pyr-card-sm" href={`/people/${c.person.id}`}>
                  <Avatar person={c.person} size="sm" status={currentStatus(c.person)} />
                  <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                    <strong>{localName(locale, c.person.nameEn, c.person.nameAr)}</strong>
                    <span className="muted small">{c.person.jobTitle}</span>
                    <StatusLine status={currentStatus(c.person)} presets={presets} />
                  </span>
                </Link>
              </li>
            ) : (
              <PyramidItem key={c.person.id} node={c} deptName={deptName} locale={locale} presets={presets} />
            ),
          )}
        </ul>
      ) : null}
    </li>
  );
}
