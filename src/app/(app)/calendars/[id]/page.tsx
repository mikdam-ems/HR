import Link from 'next/link';
import { notFound } from 'next/navigation';
import { removeHolidayAction, setHolidayAction, updateCalendarAction } from '@/app/(app)/clients/actions';
import { Flash } from '@/components/Flash';
import { WorkWeekField } from '@/components/WorkWeekField';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
import { formatDate, todayISO } from '@/lib/format';
import { getCalendar } from '@/server/clients';
import { requirePermission } from '@/server/session';
import { getSettings } from '@/server/settings';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  await requirePermission('clients.manage');
  const { t, locale } = await getDict();
  const db = await getDb();
  const { id } = await params;
  const search = await searchParams;
  const calendar = UUID.test(id) ? await getCalendar(db, id) : undefined;
  if (!calendar) notFound();
  const appSettings = await getSettings(db);

  const thisYear = Number(todayISO().slice(0, 4));
  const year = /^\d{4}$/.test(search.year ?? '') ? Number(search.year) : thisYear;
  const inYear = calendar.holidays.filter((h) => h.date.startsWith(String(year)));

  return (
    <>
      <Flash search={search} t={t} />
      <Link href="/clients">← {t.calendar.back}</Link>
      <div className="row">
        <h1>{calendar.name}</h1>
        {appSettings.homeCalendarId === calendar.id ? <span className="badge badge-brand">{t.calendar.homeBadge}</span> : null}
      </div>

      <form action={updateCalendarAction} className="card">
        <h2>{t.calendar.settings}</h2>
        <input type="hidden" name="id" value={calendar.id} />
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="name">{t.clients.name}</label>
          <input id="name" name="name" type="text" required defaultValue={calendar.name} />
        </div>
        <WorkWeekField t={t} value={calendar.workWeek} />
        <div>
          <button className="btn btn-primary">{t.form.save}</button>
        </div>
      </form>

      <section className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{fmt(t.calendar.holidays, { year })}</h2>
          <nav className="segmented" aria-label="Year">
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <Link key={y} href={`/calendars/${calendar.id}?year=${y}`} aria-current={y === year}>
                {y}
              </Link>
            ))}
          </nav>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.calendar.date}</th>
                <th>{t.calendar.name}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inYear.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    {fmt(t.calendar.noHolidays, { year })}
                  </td>
                </tr>
              ) : (
                inYear.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td>{localName(locale, h.nameEn, h.nameAr)}</td>
                    <td>
                      <form action={removeHolidayAction}>
                        <input type="hidden" name="id" value={h.id} />
                        <input type="hidden" name="calendarId" value={calendar.id} />
                        <input type="hidden" name="year" value={year} />
                        <button className="btn btn-small btn-danger">{t.calendar.remove}</button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <form action={setHolidayAction} className="card">
          <input type="hidden" name="calendarId" value={calendar.id} />
          <div className="grid-form">
            <div className="field">
              <label htmlFor="date">{t.calendar.date}</label>
              <input id="date" name="date" type="date" required />
            </div>
            <div className="field">
              <label htmlFor="h-name">{t.calendar.name}</label>
              <input id="h-name" name="nameEn" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="h-name-ar">{t.calendar.nameAr}</label>
              <input id="h-name-ar" name="nameAr" type="text" dir="rtl" lang="ar" />
            </div>
            <div>
              <button className="btn btn-primary">{t.calendar.add}</button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}
