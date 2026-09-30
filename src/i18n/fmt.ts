// Template helpers with no server dependencies, so client components can use them too.

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
