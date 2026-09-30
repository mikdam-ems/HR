import { saveSettingsAction } from '@/app/(app)/clients/actions';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { hoursSourceOn } from '@/domain';
import { fmt, getDict } from '@/i18n';
import { formatDate, todayISO } from '@/lib/format';
import { listCalendars } from '@/server/clients';
import { requirePermission } from '@/server/session';
import { getSettings } from '@/server/settings';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePermission('settings.manage');
  const { t, locale } = await getDict();
  const db = await getDb();
  const [calendarRows, s] = await Promise.all([listCalendars(db), getSettings(db)]);
  const today = todayISO();
  const current = hoursSourceOn(s.hoursSource, today);
  // A switch usually starts with a month, so the default is the first of next month.
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{t.settings.title}</h1>
      <form action={saveSettingsAction} className="card" style={{ maxWidth: 640 }}>
        <div className="field">
          <label htmlFor="home">{t.settings.homeCalendar}</label>
          <select id="home" name="homeCalendarId" defaultValue={s.homeCalendarId ?? ''}>
            <option value="">—</option>
            {calendarRows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="muted small">{t.settings.homeHint}</span>
        </div>
        <fieldset className="stack" style={{ gap: 6 }}>
          <legend className="label">{t.settings.hoursSource}</legend>
          <label className="check">
            <input type="radio" name="hoursSource" value="clock" defaultChecked={current === 'clock'} />
            {t.settings.fromClock}
          </label>
          <label className="check">
            <input type="radio" name="hoursSource" value="schedule" defaultChecked={current === 'schedule'} />
            {t.settings.fromSchedule}
          </label>
          <div className="field">
            <label htmlFor="hoursFrom">{t.settings.hoursFrom}</label>
            <input id="hoursFrom" name="hoursFrom" type="date" defaultValue={nextMonth} style={{ maxInlineSize: 200 }} />
            <span className="muted small">{t.settings.hoursFromHint}</span>
          </div>
          {s.hoursSource.length ? (
            <span className="muted small">
              {t.settings.hoursHistory}:{' '}
              {s.hoursSource
                .map((p) => fmt(t.settings.hoursPeriod, { source: t.settings.sources[p.source], date: formatDate(p.from, locale) }))
                .join(' · ')}
            </span>
          ) : null}
        </fieldset>
        <fieldset className="stack">
          <legend className="label">{t.settings.rates}</legend>
          <div className="grid-form">
            {(['regular', 'special', 'offDay'] as const).map((k) => (
              <div key={k} className="field">
                <label htmlFor={k}>{t.settings[k]}</label>
                <input id={k} name={k} type="number" step="0.05" min={1} max={5} required defaultValue={s.overtimeRates[k]} />
              </div>
            ))}
          </div>
          <span className="muted small">{t.settings.ratesHint}</span>
        </fieldset>
        <div>
          <button className="btn btn-primary">{t.form.save}</button>
        </div>
      </form>
    </>
  );
}
