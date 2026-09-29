import { describe, expect, it } from 'vitest';
import { computeDayTotals } from '../timesheet';
import { exportColumns } from '../timesheetExport';
import type { DayEntry, DayType, MonthDay } from '../index';

const rates = { regular: 1, special: 1.2, offDay: 1 };
function day(dayType: DayType, entry: Omit<DayEntry, 'date'>, expectedMinutes = dayType === 'working' || dayType === 'special_overtime' ? 510 : 0): MonthDay {
  const resolved = { date: '2026-09-01', employeeId: 'e', dayType, clientIds: ['c'], primaryClientId: 'c', expectedMinutes, schedule: null };
  const e = { date: '2026-09-01', ...entry };
  return { day: resolved, entry: e, changed: false, totals: computeDayTotals(resolved, e, rates), issues: [] };
}
const zero = { client: 0, pl: 0, sl: 0, other: 0, ph: 0, ot: 0, sot: 0 };

describe('exportColumns', () => {
  it('puts a normal day on the client and anything beyond it in OT', () => {
    expect(exportColumns(day('working', { workedMinutes: 510 }), 510)).toEqual({ ...zero, client: 510 });
    expect(exportColumns(day('working', { workedMinutes: 600 }), 510)).toEqual({ ...zero, client: 510, ot: 90 });
  });

  it('splits leave by type: annual is PL, sick is SL, the rest is other', () => {
    expect(exportColumns(day('working', { workedMinutes: 0, leave: { type: 'annual', portion: 1 } }), 510)).toEqual({ ...zero, pl: 510 });
    expect(exportColumns(day('working', { workedMinutes: 255, leave: { type: 'sick', portion: 0.5 } }), 510)).toEqual({ ...zero, client: 255, sl: 255 });
    expect(exportColumns(day('working', { workedMinutes: 0, leave: { type: 'hajj', portion: 1 } }), 510)).toEqual({ ...zero, other: 510 });
  });

  it('counts a client holiday as a full PH day, and work on it as OT', () => {
    expect(exportColumns(day('client_holiday', { workedMinutes: 0 }), 510)).toEqual({ ...zero, ph: 510 });
    expect(exportColumns(day('client_holiday', { workedMinutes: 120 }), 510)).toEqual({ ...zero, ph: 510, ot: 120 });
  });

  it('puts work on a Jordan holiday in SOT and weekend work in OT', () => {
    expect(exportColumns(day('special_overtime', { workedMinutes: 510 }), 510)).toEqual({ ...zero, sot: 510 });
    expect(exportColumns(day('weekend', { workedMinutes: 60 }), 510)).toEqual({ ...zero, ot: 60 });
    expect(exportColumns(day('weekend', { workedMinutes: 0 }), 510)).toEqual(zero);
  });
});
