import { describe, expect, it } from 'vitest';
import { ar } from '../ar';
import { en } from '../en';
import { fmt, plural } from '../index';

describe('plural forms', () => {
  it('English: one and other', () => {
    expect(fmt(en.timesheet.days, { n: 1 })).toBe('1 day');
    expect(fmt(en.timesheet.days, { n: 3 })).toBe('3 days');
    expect(fmt(en.timesheet.days, { n: 0.5 })).toBe('0.5 days');
    expect(fmt(en.people.count, { count: 1 })).toBe('1 person');
  });

  it('Arabic: one, two, few (3–10), many (11–99), other', () => {
    expect(fmt(ar.timesheet.days, { n: 1 })).toBe('يوم واحد');
    expect(fmt(ar.timesheet.days, { n: 2 })).toBe('يومان');
    expect(fmt(ar.timesheet.days, { n: 3 })).toBe('3 أيام');
    expect(fmt(ar.timesheet.days, { n: 14 })).toBe('14 يوماً');
    expect(fmt(ar.timesheet.days, { n: 100 })).toBe('100 يوم');
    expect(fmt(ar.people.count, { count: 16 })).toBe('16 شخصاً');
    expect(plural(ar.home.days, 21)).toBe('يوماً');
  });

  it('accepts numbers given as text, and leaves plain templates alone', () => {
    expect(fmt(en.timeOff.ofEntitlement, { n: '14' })).toBe('of 14 days');
    expect(fmt('Hello, {name}', { name: 'Lina' })).toBe('Hello, Lina');
  });

  it('every plural string has the right number of forms for its language', () => {
    const walk = (o: unknown, path: string, out: [string, string][]) => {
      if (typeof o === 'string') out.push([path, o]);
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, out);
      return out;
    };
    for (const [path, s] of walk(en, 'en', [])) if (s.includes('|')) expect(s.split('|'), path).toHaveLength(2);
    for (const [path, s] of walk(ar, 'ar', [])) if (s.includes('|')) expect(s.split('|'), path).toHaveLength(6);
  });
});
