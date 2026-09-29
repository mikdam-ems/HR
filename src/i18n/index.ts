import { cookies } from 'next/headers';
import { getBrand } from '@/brand';
import { ar } from './ar';
import { en, type Dict } from './en';

export type Locale = 'en' | 'ar';
export const LOCALE_COOKIE = 'locale';

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value === 'ar' ? 'ar' : 'en';
}

export async function getDict(): Promise<{ t: Dict; locale: Locale; dir: 'ltr' | 'rtl' }> {
  const [locale, brand] = await Promise.all([getLocale(), getBrand()]);
  const dict = (locale === 'ar' ? ar : en) as Dict;
  // Under the Kadr brand the product is called Kadr everywhere; the rest of the text is shared.
  const t: Dict =
    brand === 'kadr'
      ? { ...dict, appName: dict.brand.kadr, signIn: { ...dict.signIn, subtitle: dict.brand.signInSubtitle } }
      : dict;
  return { t, locale, dir: locale === 'ar' ? 'rtl' : 'ltr' };
}

/**
 * Plural forms, separated by "|" in the order Unicode CLDR names them for the language:
 * English "one|other" ('{n} day|{n} days'); Arabic "zero|one|two|few|many|other"
 * ('{n} يوم|يوم واحد|يومان|{n} أيام|{n} يوماً|{n} يوم'). A template without "|" is used as is.
 */
const PLURAL_ORDER: Record<number, { locale: string; forms: Intl.LDMLPluralRule[] }> = {
  2: { locale: 'en', forms: ['one', 'other'] },
  6: { locale: 'ar', forms: ['zero', 'one', 'two', 'few', 'many', 'other'] },
};

/** Picks the right plural form of a template for n. */
export function plural(template: string, n: number): string {
  const parts = template.split('|');
  const order = PLURAL_ORDER[parts.length];
  if (!order) return parts[parts.length - 1]!;
  const category = new Intl.PluralRules(order.locale).select(n);
  return parts[order.forms.indexOf(category)] ?? parts[parts.length - 1]!;
}

/** Fills {placeholders}: fmt('Hello, {name}', { name: 'Lina' }). Plural templates follow {n} or {count}. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  const raw = vars.n ?? vars.count;
  const n = raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const chosen = template.includes('|') && n !== null ? plural(template, n) : template;
  return chosen.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
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
