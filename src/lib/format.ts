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

/** 510 → "8h 30m"; in Arabic "8 س 30 د" (ساعة / دقيقة). */
export function formatHours(minutes: number, locale: Locale = 'en'): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (locale === 'ar') return !h && m ? `${m} د` : m ? `${h} س ${m} د` : `${h} س`;
  return !h && m ? `${m}m` : m ? `${h}h ${m}m` : `${h}h`;
}

/** Up to two initials for an avatar badge: "Rania Saleh" → "RS". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** "09:05" — the time of day in Amman. */
export function timeOfDay(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** The instant a local Amman date and time ("2026-09-27", "18:30") refers to. */
export function ammanInstant(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  // Offset of Amman from UTC at that moment, in minutes (Jordan is UTC+3 all year, but don't hard-code it).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (local - guess.getTime()));
}
