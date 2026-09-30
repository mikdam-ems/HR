import { cache } from 'react';
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { z } from 'zod';
import { monthClosures, settings } from '@/db/schema';
import { type HoursPeriod, type OvertimeRates, checkNewHoursPeriod } from '@/domain';
import { audit } from './audit';
import { type Result, fail, isoDate, ok, parse } from './validation';

export interface AppSettings {
  /** EMS's own calendar (Jordan). Its holidays trigger special overtime. */
  homeCalendarId: string | null;
  overtimeRates: OvertimeRates;
  /**
   * Where a day's hours come from, as dated periods (oldest first): from each `from` on, the clock or the
   * schedule. Before the first period, the schedule. A switch never changes days before its date.
   */
  hoursSource: HoursPeriod[];
}

/** Only special (1.2) is decided; regular and off-day are placeholders until HR confirms. */
export const DEFAULT_SETTINGS: AppSettings = {
  homeCalendarId: null,
  overtimeRates: { regular: 1, special: 1.2, offDay: 1 },
  // The clock takes over with the first month of the 8h30 day; September and earlier keep the schedule.
  hoursSource: [{ from: '2026-10-01', source: 'clock' }],
};

const hoursPeriod = z.object({ from: isoDate, source: z.enum(['clock', 'schedule']) });

/** Reads the stored periods. Before periods existed the setting was a bare 'clock' | 'schedule' with no date. */
function readHoursSource(value: unknown): HoursPeriod[] {
  const periods = z.array(hoursPeriod).safeParse(value);
  if (periods.success) return [...periods.data].sort((a, b) => a.from.localeCompare(b.from));
  return value === 'schedule' ? [] : DEFAULT_SETTINGS.hoursSource;
}

async function getSettingsUncached(db: DB): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    homeCalendarId: (map.homeCalendarId as string | undefined) ?? DEFAULT_SETTINGS.homeCalendarId,
    overtimeRates: { ...DEFAULT_SETTINGS.overtimeRates, ...(map.overtimeRates as Partial<OvertimeRates>) },
    hoursSource: readHoursSource(map.hoursSource),
  };
}

export async function setSetting<K extends keyof AppSettings>(db: DB, key: K, value: AppSettings[K]): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key));
  if (existing.length) await db.update(settings).set({ value }).where(eq(settings.key, key));
  else await db.insert(settings).values({ key, value });
}

/** Loaded once per page render and shared by everything on the page. */
export const getSettings = cache(getSettingsUncached);

/**
 * Switches where hours come from, starting on a date. Days before it keep the source they were counted under,
 * so it can't start before the latest switch, or in or before a closed month.
 */
export async function setHoursSource(db: DB, actorId: string | null, input: HoursPeriod): Promise<Result<void>> {
  const parsed = parse(hoursPeriod, input);
  if (!parsed.ok) return parsed;
  const next = parsed.value;
  const [current, closures] = await Promise.all([getSettingsUncached(db), db.select().from(monthClosures)]);
  const closed = closures.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`);
  // The message explains both cases; the internal reason isn't shown to people.
  if (checkNewHoursPeriod(current.hoursSource, next, closed)) return fail('hours_source_date');
  // A second switch on the same date replaces the first.
  const periods = [...current.hoursSource.filter((p) => p.from !== next.from), next];
  await setSetting(db, 'hoursSource', periods);
  await audit(db, { actorId, action: 'update', entity: 'settings', before: { hoursSource: current.hoursSource }, after: { hoursSource: periods } });
  return ok(undefined);
}
