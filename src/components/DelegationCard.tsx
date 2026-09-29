import { cancelDelegationAction, createDelegationAction } from '@/app/(app)/approvals/actions';
import type { Employee } from '@/db/schema';
import { fmt, localName, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, todayISO } from '@/lib/format';
import type { listDelegations } from '@/server/delegation';

/**
 * A manager's hand-overs and the form to add one. On the Approvals page for the manager themselves; on a manager's
 * profile for People & Culture ("Approvals while Khaled is away").
 */
export function DelegationCard({
  manager,
  delegations,
  people,
  own,
  back,
  t,
  locale,
}: {
  manager: Pick<Employee, 'id' | 'nameEn' | 'nameAr'>;
  delegations: Awaited<ReturnType<typeof listDelegations>>;
  people: Employee[];
  own: boolean;
  back: string;
  t: Dict;
  locale: Locale;
}) {
  const d = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short' });
  const today = todayISO();
  const title = own ? t.delegation.title : fmt(t.delegation.titleFor, { name: localName(locale, manager.nameEn, manager.nameAr) });
  return (
    <section className="card" aria-labelledby="delegation">
      <div className="stack" style={{ gap: 2 }}>
        <h2 id="delegation">{title}</h2>
        <span className="muted small">{t.delegation.hint}</span>
      </div>
      {delegations.length ? (
        <ul className="list-rows">
          {delegations.map((x) => (
            <li key={x.id}>
              <span>
                {fmt(t.delegation.active, {
                  name: localName(locale, x.deputy.nameEn, x.deputy.nameAr),
                  from: d(x.fromDate),
                  to: d(x.toDate),
                })}
                {x.fromDate <= today ? <span className="badge badge-brand" style={{ marginInlineStart: 8 }}>{t.delegation.now}</span> : null}
              </span>
              <form action={cancelDelegationAction}>
                <input type="hidden" name="id" value={x.id} />
                <input type="hidden" name="back" value={back} />
                <button className="btn btn-small">{t.delegation.cancel}</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <span className="muted">{t.delegation.none}</span>
      )}
      <form action={createDelegationAction} className="row" style={{ alignItems: 'flex-end' }}>
        <input type="hidden" name="managerId" value={manager.id} />
        <input type="hidden" name="back" value={back} />
        <div className="field">
          <label htmlFor="deputyId">{t.delegation.deputy}</label>
          <select id="deputyId" name="deputyId" required style={{ width: 220 }}>
            {people
              .filter((p) => p.active && p.id !== manager.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {localName(locale, p.nameEn, p.nameAr)}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="delegation-from">{t.delegation.from}</label>
          <input id="delegation-from" name="fromDate" type="date" required min={today} defaultValue={today} />
        </div>
        <div className="field">
          <label htmlFor="delegation-to">{t.delegation.to}</label>
          <input id="delegation-to" name="toDate" type="date" required min={today} />
        </div>
        <button className="btn btn-primary">{t.delegation.add}</button>
      </form>
    </section>
  );
}
