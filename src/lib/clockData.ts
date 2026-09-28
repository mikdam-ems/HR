import type { ClockData } from '@/components/Clock';
import type { Locale } from '@/i18n';
import type { ClockView } from '@/server/clock';
import { formatDate, timeOfDay } from './format';

/** Turns the server's clock view into plain data the client clock can render. */
export function toClockData(view: ClockView, locale: Locale, targetMinutes: number): ClockData {
  return {
    targetMs: targetMinutes * 60_000,
    state: view.state,
    since: view.since?.toISOString() ?? null,
    workedMs: view.today.workedMs,
    breakMs: view.today.breakMs,
    startedAt: view.today.firstIn ? timeOfDay(view.today.firstIn) : null,
    openFrom: view.openFrom
      ? {
          date: view.openFrom.date,
          label: `${formatDate(view.openFrom.date, locale, { weekday: 'long', day: 'numeric', month: 'short' })} ${timeOfDay(view.openFrom.at)}`,
        }
      : null,
  };
}
