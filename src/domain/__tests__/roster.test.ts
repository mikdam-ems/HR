import { describe, expect, it } from 'vitest';
import { rosterWeek } from '../roster';
import type { RulesContext } from '../types';
import { ctx as base } from './fixtures';

// Hala-style client with named shifts; Client B works Sun–Thu + Sat and has a holiday on 15 September.
const ctx: RulesContext = {
  ...base,
  schedules: [
    ...base.schedules.filter((s) => s.employeeId !== 'hala' && s.employeeId !== 'lina'),
    { employeeId: 'hala', effectiveFrom: '2026-01-01', start: '07:00', end: '15:00', shiftCode: 'Morning', clientShiftId: 'm' },
    { employeeId: 'hala', effectiveFrom: '2026-09-16', start: '15:00', end: '23:00', shiftCode: 'Evening', clientShiftId: 'e' },
    { employeeId: 'lina', effectiveFrom: '2026-01-01', start: '09:00', end: '17:30' },
  ],
};
// 13 Sep 2026 is a Sunday.
const week = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];

describe('rosterWeek', () => {
  it('shows each person’s shift per day, with days off, holidays and leave', () => {
    const onLeave = (id: string, d: string) => id === 'hala' && d === '2026-09-17';
    const { rows, coverage } = rosterWeek(ctx, 'clientB', week, onLeave);
    const hala = rows.find((r) => r.employeeId === 'hala')!;
    expect(hala.cells.map((c) => (c.kind === 'shift' ? c.shiftId : c.kind))).toEqual([
      'm',
      'm',
      'holiday',
      'e',
      'leave',
      'off', // Friday
      'e', // Saturday is a working day for Client B
    ]);
    expect(coverage.m).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(coverage.e).toEqual([0, 0, 0, 1, 0, 0, 1]);
  });

  it('lists only people assigned to the client in the week; custom hours have no shift id', () => {
    const { rows, coverage } = rosterWeek(ctx, 'clientB', week, () => false);
    expect(rows.map((r) => r.employeeId).sort()).toEqual(['hala', 'lina']);
    const lina = rows.find((r) => r.employeeId === 'lina')!;
    // Lina's primary client is Jadwa (Sun–Thu), so her Saturday is off even on Client B's roster.
    expect(lina.cells[0]).toEqual({ kind: 'shift', shiftId: null, start: '09:00', end: '17:30' });
    expect(lina.cells[6]).toEqual({ kind: 'off' });
    expect(coverage['']).toEqual([1, 1, 0, 1, 1, 0, 0]);
  });

  it('marks days outside the assignment', () => {
    const { rows } = rosterWeek(ctx, 'clientB', ['2026-09-30', '2026-10-01'], () => false);
    const lina = rows.find((r) => r.employeeId === 'lina')!;
    expect(lina.cells.map((c) => c.kind)).toEqual(['shift', 'none']);
  });
});
