import { addDays } from './dates';
import type { ISODate } from './types';

export interface CelebrationPerson {
  id: string;
  birthDate: ISODate | null;
  hireDate: ISODate | null;
}

export interface Celebration {
  employeeId: string;
  kind: 'birthday' | 'anniversary';
  date: ISODate;
  /** Age on a birthday; years at EMS on an anniversary. */
  years: number;
}

/** Birthdays and work anniversaries falling in the `days` days starting `from`, soonest first. */
export function upcomingCelebrations(people: readonly CelebrationPerson[], from: ISODate, days: number): Celebration[] {
  const out: Celebration[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    for (const p of people) {
      for (const [kind, origin] of [
        ['anniversary', p.hireDate],
        ['birthday', p.birthDate],
      ] as const) {
        if (!origin || !fallsOn(origin, date)) continue;
        const years = Number(date.slice(0, 4)) - Number(origin.slice(0, 4));
        if (years > 0) out.push({ employeeId: p.id, kind, date, years });
      }
    }
  }
  return out;
}

/** Whether a yearly date (e.g. a birthday) falls on `date`; 29 February is kept on 28 February in other years. */
function fallsOn(origin: ISODate, date: ISODate): boolean {
  const md = origin.slice(5);
  if (md === date.slice(5)) return true;
  return md === '02-29' && date.slice(5) === '02-28' && !isLeap(Number(date.slice(0, 4)));
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
