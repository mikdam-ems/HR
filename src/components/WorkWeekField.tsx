import type { Dict } from '@/i18n/en';

export function WorkWeekField({ t, value = [0, 1, 2, 3, 4] }: { t: Dict; value?: number[] }) {
  return (
    <fieldset className="stack" style={{ gap: 4 }}>
      <legend className="label">{t.clients.workWeek}</legend>
      <div className="row" style={{ gap: 12 }}>
        {t.weekdays.map((label, i) => (
          <label key={i} className="check">
            <input type="checkbox" name="workWeek" value={i} defaultChecked={value.includes(i)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
