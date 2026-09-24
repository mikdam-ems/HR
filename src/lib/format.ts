import type { Locale } from '@/i18n';

/** EMS is in Amman; "today" means today there, whatever the server's time zone. */
export const TIME_ZONE = 'Asia/Amman';

export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
}

/** Formats an ISO date for display. Arabic uses Western digits, as in the wireframes. */
export function formatDate(iso: string, locale: Locale, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  const tag = locale === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB';
  return new Intl.DateTimeFormat(tag, { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
