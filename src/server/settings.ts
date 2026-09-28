import { cache } from 'react';
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { settings } from '@/db/schema';
import type { OvertimeRates } from '@/domain';

export interface AppSettings {
  /** EMS's own calendar (Jordan). Its holidays trigger special overtime. */
  homeCalendarId: string | null;
  overtimeRates: OvertimeRates;
  /** Where a day's hours come from: clocked time (default), or the schedule as before the clock existed. */
  hoursSource: 'clock' | 'schedule';
}

/** Only special (1.2) is decided; regular and off-day are placeholders until HR confirms. */
export const DEFAULT_SETTINGS: AppSettings = {
  homeCalendarId: null,
  overtimeRates: { regular: 1, special: 1.2, offDay: 1 },
  hoursSource: 'clock',
};

async function getSettingsUncached(db: DB): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    homeCalendarId: (map.homeCalendarId as string | undefined) ?? DEFAULT_SETTINGS.homeCalendarId,
    overtimeRates: { ...DEFAULT_SETTINGS.overtimeRates, ...(map.overtimeRates as Partial<OvertimeRates>) },
    hoursSource: map.hoursSource === 'schedule' ? 'schedule' : DEFAULT_SETTINGS.hoursSource,
  };
}

export async function setSetting<K extends keyof AppSettings>(db: DB, key: K, value: AppSettings[K]): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key));
  if (existing.length) await db.update(settings).set({ value }).where(eq(settings.key, key));
  else await db.insert(settings).values({ key, value });
}

/** Loaded once per page render and shared by everything on the page. */
export const getSettings = cache(getSettingsUncached);
