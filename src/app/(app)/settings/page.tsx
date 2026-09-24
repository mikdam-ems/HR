import { saveSettingsAction } from '@/app/(app)/clients/actions';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { getDict } from '@/i18n';
import { listCalendars } from '@/server/clients';
import { requirePermission } from '@/server/session';
import { getSettings } from '@/server/settings';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePermission('settings.manage');
  const { t } = await getDict();
  const db = await getDb();
  const [calendarRows, s] = await Promise.all([listCalendars(db), getSettings(db)]);

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
