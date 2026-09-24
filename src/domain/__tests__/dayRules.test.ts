import { describe, expect, it } from 'vitest';
import { resolveDay } from '../dayRules';
import { ctx } from './fixtures';

const type = (employeeId: string, date: string) => resolveDay(ctx, employeeId, date).dayType;

describe('day rules (plan: "Day rules" table)', () => {
  it('Saudi holiday, normal day in Jordan → day off, no leave', () => {
    const day = resolveDay(ctx, 'omar', '2026-09-23');
    expect(day.dayType).toBe('client_holiday');
    expect(day.holidayName).toBe('Saudi National Day');
    expect(day.expectedMinutes).toBe(0);
  });

  it('Jordanian holiday while the client is working → special overtime, full hours expected', () => {
    const day = resolveDay(ctx, 'omar', '2026-05-25'); // Monday
    expect(day.dayType).toBe('special_overtime');
    expect(day.holidayName).toBe('Independence Day');
    expect(day.expectedMinutes).toBe(480);
  });

  it('holiday in both countries → client holiday wins', () => {
    expect(type('omar', '2026-06-01')).toBe('client_holiday');
  });

  it('Jordanian holiday on the client weekend → just a weekend', () => {
    expect(type('omar', '2026-05-29')).toBe('weekend'); // Friday
  });

  it('client work week decides weekends: Fri/Sat off for a Sun–Thu client', () => {
    expect(type('omar', '2026-09-04')).toBe('weekend'); // Friday
    expect(type('omar', '2026-09-05')).toBe('weekend'); // Saturday
    expect(type('omar', '2026-09-06')).toBe('working'); // Sunday
  });

  it('a client that works Saturdays makes Saturday a working day', () => {
    expect(type('hala', '2026-09-05')).toBe('working'); // Saturday
    expect(type('hala', '2026-09-04')).toBe('weekend'); // Friday
  });

  it('two clients, only one has a holiday → day off', () => {
    const day = resolveDay(ctx, 'lina', '2026-09-15'); // Client B holiday, Jadwa working
    expect(day.dayType).toBe('client_holiday');
    expect(day.clientIds).toEqual(['jadwa', 'clientB']);
  });

  it('with two clients, the primary one sets the work week', () => {
    // Saturday: Client B works, but Lina's primary (Jadwa) does not.
    const day = resolveDay(ctx, 'lina', '2026-09-12');
    expect(day.primaryClientId).toBe('jadwa');
    expect(day.dayType).toBe('weekend');
  });

  it('moving to a new client switches calendars on the start date', () => {
    expect(resolveDay(ctx, 'sami', '2026-06-30').primaryClientId).toBe('clientB');
    expect(resolveDay(ctx, 'sami', '2026-07-01').primaryClientId).toBe('jadwa');
    expect(type('sami', '2026-06-27')).toBe('working'); // Saturday on Client B
    expect(type('sami', '2026-07-04')).toBe('weekend'); // Saturday on Jadwa
  });

  it('no active assignment → unassigned, nothing expected', () => {
    const day = resolveDay(ctx, 'sami', '2025-12-31');
    expect(day.dayType).toBe('unassigned');
    expect(day.expectedMinutes).toBe(0);
  });
});

describe('schedules', () => {
  it('uses the schedule in effect on the date', () => {
    expect(resolveDay(ctx, 'omar', '2026-09-30').expectedMinutes).toBe(480); // 09:00–17:00
    expect(resolveDay(ctx, 'omar', '2026-10-01').expectedMinutes).toBe(540); // 12:00–21:00
  });

  it('handles a night shift that crosses midnight', () => {
    const day = resolveDay(ctx, 'omar', '2026-11-01');
    expect(day.schedule?.shiftCode).toBe('C');
    expect(day.expectedMinutes).toBe(480); // 22:00–06:00
  });
});
