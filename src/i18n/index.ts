import { cookies } from 'next/headers';
import { ar } from './ar';
import { en, type Dict } from './en';

export type Locale = 'en' | 'ar';
export const LOCALE_COOKIE = 'locale';

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value === 'ar' ? 'ar' : 'en';
}

export async function getDict(): Promise<{ t: Dict; locale: Locale; dir: 'ltr' | 'rtl' }> {
  const locale = await getLocale();
  return { t: (locale === 'ar' ? ar : en) as Dict, locale, dir: locale === 'ar' ? 'rtl' : 'ltr' };
}

/** Fills {placeholders}: fmt('Hello, {name}', { name: 'Lina' }). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** The holiday name that decided a day's type, in the page's language. */
export function holidayLabel(locale: Locale, day: { holidayName?: string; holidayNameAr?: string }): string | undefined {
  return day.holidayName ? localName(locale, day.holidayName, day.holidayNameAr) : undefined;
}

/** Client names from the rules context, in the page's language. */
export function clientLabel(
  locale: Locale,
  clients: Record<string, { name: string; nameAr?: string }>,
  ids: readonly (string | null)[],
): string {
  return [...new Set(ids.filter((id): id is string => !!id))]
    .map((id) => (clients[id] ? localName(locale, clients[id].name, clients[id].nameAr) : ''))
    .join(', ');
}

/** Arabic name when the page is in Arabic and one exists. */
export function localName(locale: Locale, en: string, ar: string | null | undefined): string {
  return locale === 'ar' && ar ? ar : en;
}
