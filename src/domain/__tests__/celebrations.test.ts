import { describe, expect, it } from 'vitest';
import { upcomingCelebrations } from '../celebrations';

describe('upcomingCelebrations', () => {
  const people = [
    { id: 'a', birthDate: '1990-10-02', hireDate: '2021-09-28' },
    { id: 'b', birthDate: null, hireDate: '2026-09-29' },
    { id: 'c', birthDate: '1995-12-31', hireDate: '2019-10-01' },
    { id: 'd', birthDate: '1992-02-29', hireDate: null },
  ];

  it('finds birthdays and work anniversaries within the window, soonest first', () => {
    expect(upcomingCelebrations(people, '2026-09-28', 7)).toEqual([
      { employeeId: 'a', kind: 'anniversary', date: '2026-09-28', years: 5 },
      { employeeId: 'c', kind: 'anniversary', date: '2026-10-01', years: 7 },
      { employeeId: 'a', kind: 'birthday', date: '2026-10-02', years: 36 },
    ]);
  });

  it('skips the hire day itself (that is a first day, not an anniversary)', () => {
    expect(upcomingCelebrations([{ id: 'b', birthDate: null, hireDate: '2026-09-29' }], '2026-09-28', 7)).toEqual([]);
  });

  it('wraps across the new year', () => {
    expect(upcomingCelebrations(people, '2026-12-30', 3).map((c) => c.date)).toEqual(['2026-12-31']);
  });

  it('celebrates 29 February on 28 February in other years', () => {
    expect(upcomingCelebrations(people, '2027-02-28', 1)).toEqual([
      { employeeId: 'd', kind: 'birthday', date: '2027-02-28', years: 35 },
    ]);
    expect(upcomingCelebrations(people, '2028-02-28', 2).map((c) => c.date)).toEqual(['2028-02-29']);
  });
});
