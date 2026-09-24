import Link from 'next/link';
import { createCalendarAction, createClientAction } from '@/app/(app)/clients/actions';
import { Flash } from '@/components/Flash';
import { WorkWeekField } from '@/components/WorkWeekField';
import { getDb } from '@/db';
import { getDict, localName } from '@/i18n';
import { listCalendars, listClients } from '@/server/clients';
import { requirePermission } from '@/server/session';
import { getSettings } from '@/server/settings';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePermission('clients.manage');
  const { t, locale } = await getDict();
  const db = await getDb();
  const [clientRows, calendarRows, appSettings] = await Promise.all([listClients(db), listCalendars(db), getSettings(db)]);
  const weekLabel = (days: number[]) => days.map((d) => t.weekdays[d]).join(', ');

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{t.clients.title}</h1>

      <section className="stack">
        <h2>{t.clients.clients}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.clients.name}</th>
                <th>{t.clients.calendar}</th>
                <th>{t.clients.workWeek}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clientRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {t.clients.noClients}
                  </td>
                </tr>
              ) : (
                clientRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {localName(locale, c.nameEn, c.nameAr)}{' '}
                      {!c.active ? <span className="badge">{t.clients.inactive}</span> : null}
                    </td>
                    <td>
                      <Link href={`/calendars/${c.calendarId}`}>{c.calendar.name}</Link>
                    </td>
                    <td>{weekLabel(c.calendar.workWeek)}</td>
                    <td>
                      <Link href={`/clients/${c.id}`}>{t.clients.editClient}</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {calendarRows.length ? (
          <form action={createClientAction} className="card">
            <h3>{t.clients.addClient}</h3>
            <div className="grid-form">
              <div className="field">
                <label htmlFor="c-name">{t.clients.name}</label>
                <input id="c-name" name="nameEn" type="text" required />
              </div>
              <div className="field">
                <label htmlFor="c-name-ar">{t.clients.nameAr}</label>
                <input id="c-name-ar" name="nameAr" type="text" dir="rtl" lang="ar" />
              </div>
              <div className="field">
                <label htmlFor="c-cal">{t.clients.calendar}</label>
                <select id="c-cal" name="calendarId" required>
                  {calendarRows.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <button className="btn btn-primary">{t.clients.addClient}</button>
              </div>
            </div>
          </form>
        ) : null}
      </section>

      <section className="stack">
        <h2>{t.clients.calendars}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.clients.name}</th>
                <th>{t.clients.workWeek}</th>
                <th>{t.clients.holidays}</th>
                <th>{t.clients.usedBy}</th>
              </tr>
            </thead>
            <tbody>
              {calendarRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {t.clients.noCalendars}
                  </td>
                </tr>
              ) : (
                calendarRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/calendars/${c.id}`}>{c.name}</Link>{' '}
                      {appSettings.homeCalendarId === c.id ? (
                        <span className="badge badge-brand">{t.calendar.homeBadge}</span>
                      ) : null}
                    </td>
                    <td>{weekLabel(c.workWeek)}</td>
                    <td>{c.holidays.length}</td>
                    <td>{c.clients.map((cl) => localName(locale, cl.nameEn, cl.nameAr)).join(', ') || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <form action={createCalendarAction} className="card">
          <h3>{t.clients.addCalendar}</h3>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="cal-name">{t.clients.name}</label>
            <input id="cal-name" name="name" type="text" required placeholder="Saudi Arabia (Sun–Thu)" />
          </div>
          <WorkWeekField t={t} />
          <div>
            <button className="btn btn-primary">{t.clients.addCalendar}</button>
          </div>
        </form>
      </section>
    </>
  );
}
