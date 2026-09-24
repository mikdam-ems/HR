import Link from 'next/link';
import { DayBadge } from '@/components/DayBadge';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import type { Employee } from '@/db/schema';
import { resolveDay, type ResolvedDay } from '@/domain';
import { fmt, getDict, localName, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { todayISO } from '@/lib/format';
import { listClients } from '@/server/clients';
import { buildOrgTree, type OrgNode } from '@/server/orgTree';
import { listEmployees } from '@/server/people';
import { can } from '@/server/permissions';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';

type Search = Record<string, string | undefined>;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const search = await searchParams;
  const view = search.view === 'chart' ? 'chart' : 'list';
  const q = (search.q ?? '').trim().toLowerCase();
  const clientFilter = search.client ?? '';

  const db = await getDb();
  const [people, ctx, clientRows] = await Promise.all([listEmployees(db), loadRulesContext(db), listClients(db)]);
  const today = todayISO();
  const days = new Map(people.map((p) => [p.id, resolveDay(ctx, p.id, today)]));
  const byId = new Map(people.map((p) => [p.id, p]));

  const shown = people.filter((p) => {
    const matchesText =
      !q || [p.nameEn, p.nameAr ?? '', p.email, p.jobTitle ?? ''].some((s) => s.toLowerCase().includes(q));
    const matchesClient = !clientFilter || days.get(p.id)!.clientIds.includes(clientFilter);
    return matchesText && matchesClient;
  });

  const hrefFor = (v: string) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(clientFilter ? { client: clientFilter } : {}), view: v });
    return `/people?${params}`;
  };

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
          <button className="btn">{t.people.filter}</button>
        </form>
        <nav className="segmented" aria-label="View">
          <Link href={hrefFor('list')} aria-current={view === 'list'}>
            {t.people.list}
          </Link>
          <Link href={hrefFor('chart')} aria-current={view === 'chart'}>
            {t.people.chart}
          </Link>
        </nav>
      </div>

      {view === 'chart' ? (
        <ul className="org" aria-label={t.people.chart}>
          {buildOrgTree(shown).map((n) => (
            <OrgItem key={n.person.id} node={n} days={days} ctxClients={ctx.clients} locale={locale} t={t} />
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.people.name}</th>
                <th>{t.people.jobTitle}</th>
                <th>{t.people.manager}</th>
                <th>{t.people.currentClient}</th>
                <th>{t.people.today}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
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
                        <Link href={`/people/${p.id}`}>{localName(locale, p.nameEn, p.nameAr)}</Link>
                        <div className="muted small">{p.email}</div>
                      </td>
                      <td>{p.jobTitle ?? t.people.none}</td>
                      <td>{manager ? localName(locale, manager.nameEn, manager.nameAr) : t.people.none}</td>
                      <td>{clientNames(d, ctx.clients) || t.people.none}</td>
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

function clientNames(d: ResolvedDay, clients: Record<string, { name: string }>) {
  return [...new Set(d.clientIds)].map((id) => clients[id]?.name ?? '').join(', ');
}

function OrgItem({
  node,
  days,
  ctxClients,
  locale,
  t,
}: {
  node: OrgNode<Employee>;
  days: Map<string, ResolvedDay>;
  ctxClients: Record<string, { name: string }>;
  locale: Locale;
  t: Dict;
}) {
  const p = node.person;
  const d = days.get(p.id)!;
  return (
    <li>
      <Link className="org-card" href={`/people/${p.id}`}>
        <span className="avatar" aria-hidden="true">
          {p.nameEn
            .split(/\s+/)
            .map((s) => s[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span className="stack" style={{ gap: 0 }}>
          <strong style={{ fontWeight: 600 }}>{localName(locale, p.nameEn, p.nameAr)}</strong>
          <span className="muted small">
            {[p.jobTitle, clientNames(d, ctxClients)].filter(Boolean).join(' · ') || t.people.none}
          </span>
        </span>
      </Link>
      {node.reports.length ? (
        <ul>
          {node.reports.map((c) => (
            <OrgItem key={c.person.id} node={c} days={days} ctxClients={ctxClients} locale={locale} t={t} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
