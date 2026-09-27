import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updateClientAction } from '@/app/(app)/clients/actions';
import { Avatar } from '@/components/Avatar';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, todayISO } from '@/lib/format';
import { getClientProfile, listCalendars, type ClientProfile } from '@/server/clients';
import { can } from '@/server/permissions';
import { currentStatus } from '@/server/profile';
import { requireUser } from '@/server/session';

/** A client's page: who works on it now, its calendar and holidays. Everyone can see it; HR edits it. */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const today = todayISO();
  const profile = await getClientProfile(db, (await params).id, today);
  if (!profile) notFound();
  const { client, current, upcoming, past, upcomingHolidays } = profile;
  const manage = can(user, 'clients.manage');
  const calendarRows = manage ? await listCalendars(db) : [];
  const offDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !client.calendar.workWeek.includes(d)).map((d) => t.weekdays[d]);
  const departments = [...new Map(current.flatMap((a) => (a.employee.department ? [[a.employee.department.id, a.employee.department]] : []))).values()];
  const d = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <Link href={manage ? '/clients' : '/people'} className="small back-link">
        <span className="flip" aria-hidden="true">←</span> {manage ? t.client.back : t.nav.people}
      </Link>

      <div className="bento">
        <section className="card card-dark span-8 dept-hero">
          <span className="eyebrow">{t.client.eyebrow}</span>
          <div className="row">
            <h1>{localName(locale, client.nameEn, client.nameAr)}</h1>
            {!client.active ? <span className="badge badge-danger">{t.clients.inactive}</span> : null}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip">
              <span className="chip-label">{t.clients.calendar}</span>
              {client.calendar.name}
            </span>
            <span className="chip">
              <span className="chip-label">{t.client.daysOff}</span>
              {offDays.join(', ') || '—'}
            </span>
          </div>
          {departments.length ? (
            <div className="row" style={{ gap: 6 }}>
              {departments.map((dep) => (
                <Link key={dep.id} href={`/people/departments/${dep.id}`} className="chip">
                  {localName(locale, dep.nameEn, dep.nameAr)}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
        <div className="span-4 stack" style={{ gap: 20 }}>
          <section className="card kpi">
            <span className="label">{t.client.onClient}</span>
            <strong className="kpi-value">{current.length}</strong>
            <div className="avatars">
              {current.slice(0, 8).map((a) => (
                <span key={a.id} className="avatar-link" title={a.employee.nameEn}>
                  <Avatar person={a.employee} size="sm" />
                </span>
              ))}
            </div>
          </section>
          <section className="card">
            <span className="label">{t.client.holidays}</span>
            {upcomingHolidays.length ? (
              <ul className="holiday-list">
                {upcomingHolidays.map((h) => (
                  <li key={h.id}>
                    <strong>{formatDate(h.date, locale, { day: 'numeric', month: 'short' })}</strong>
                    <span>{locale === 'ar' && h.nameAr ? h.nameAr : h.nameEn}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted small">{t.client.noHolidays}</span>
            )}
          </section>
        </div>

        <section className="card span-12">
          <h2>{t.client.peopleNow}</h2>
          {current.length ? (
            <People rows={current} t={t} locale={locale} note={(a) => fmt(t.client.since, { date: d(a.startDate) }) + (a.endDate ? ` · ${fmt(t.client.until, { date: d(a.endDate) })}` : '')} />
          ) : (
            <span className="muted">{t.client.nobody}</span>
          )}
        </section>

        {upcoming.length ? (
          <section className="card span-6">
            <h2>{t.client.upcoming}</h2>
            <People rows={upcoming} t={t} locale={locale} note={(a) => fmt(t.client.since, { date: d(a.startDate) })} compact />
          </section>
        ) : null}
        {past.length ? (
          <section className="card span-6">
            <h2>{t.client.past}</h2>
            <People rows={past} t={t} locale={locale} note={(a) => fmt(t.client.ended, { date: d(a.endDate!) })} compact />
          </section>
        ) : null}

        {manage ? (
          <details className="card span-12">
            <summary className="btn btn-small" style={{ alignSelf: 'flex-start' }}>
              {t.client.edit}
            </summary>
            <form action={updateClientAction} className="stack" style={{ marginTop: 16 }}>
              <input type="hidden" name="id" value={client.id} />
              <div className="grid-form">
                <div className="field">
                  <label htmlFor="nameEn">{t.clients.name}</label>
                  <input id="nameEn" name="nameEn" type="text" required defaultValue={client.nameEn} />
                </div>
                <div className="field">
                  <label htmlFor="nameAr">{t.clients.nameAr}</label>
                  <input id="nameAr" name="nameAr" type="text" dir="rtl" lang="ar" defaultValue={client.nameAr ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor="calendarId">{t.clients.calendar}</label>
                  <select id="calendarId" name="calendarId" defaultValue={client.calendarId}>
                    {calendarRows.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="check">
                <input type="checkbox" name="active" defaultChecked={client.active} />
                {t.clients.active}
              </label>
              <div>
                <button className="btn btn-primary">{t.form.save}</button>
              </div>
            </form>
          </details>
        ) : null}
      </div>
    </>
  );
}

type Row = ClientProfile['current'][number];

function People({
  rows,
  t,
  locale,
  note,
  compact = false,
}: {
  rows: Row[];
  t: Dict;
  locale: 'en' | 'ar';
  note: (a: Row) => string;
  compact?: boolean;
}) {
  return (
    <ul className={compact ? 'list-rows' : 'member-grid'}>
      {rows.map((a) => {
        const e = a.employee;
        const status = currentStatus(e);
        return (
          <li key={a.id}>
            <Link href={`/people/${e.id}`} className={compact ? 'person' : 'member-card'}>
              <Avatar person={e} size={compact ? 'sm' : 'lg'} status={status} />
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong style={{ fontWeight: compact ? 500 : 600 }}>{localName(locale, e.nameEn, e.nameAr)}</strong>
                <span className="muted small">
                  {[e.jobTitle, e.department ? localName(locale, e.department.nameEn, e.department.nameAr) : null].filter(Boolean).join(' · ')}
                </span>
                {!compact ? <span className="small">{note(a)}</span> : null}
              </span>
              {!compact && !a.primary ? <span className="pill pill-muted member-meta">{t.client.secondary}</span> : null}
            </Link>
            {compact ? <span className="muted small">{note(a)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
