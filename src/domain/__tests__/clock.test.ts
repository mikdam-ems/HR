import { describe, expect, it } from 'vitest';
import { type ClockEvent, canClock, stateAfter, summarizeClock, msToMinutes } from '../clock';

// Amman is UTC+3 all year.
const at = (local: string) => new Date(`${local}:00+03:00`);
const dateOf = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const ev = (kind: ClockEvent['kind'], local: string): ClockEvent => ({ kind, at: at(local) });

describe('clock', () => {
  it('works out the state and which actions are allowed', () => {
    expect(stateAfter([])).toEqual({ state: 'out', since: null });
    expect(stateAfter([ev('in', '2026-09-27T09:00'), ev('break_start', '2026-09-27T13:00')]).state).toBe('break');
    expect(canClock('out', 'in')).toBe(true);
    expect(canClock('out', 'out')).toBe(false);
    expect(canClock('break', 'out')).toBe(true);
    expect(canClock('working', 'in')).toBe(false);
  });

  it('sums work and breaks for a day', () => {
    const days = summarizeClock(
      [
        ev('in', '2026-09-27T09:05'),
        ev('break_start', '2026-09-27T13:00'),
        ev('break_end', '2026-09-27T13:45'),
        ev('out', '2026-09-27T19:10'),
      ],
      at('2026-09-27T22:00'),
      dateOf,
    );
    const d = days.get('2026-09-27')!;
    expect(msToMinutes(d.workedMs)).toBe(9 * 60 + 20);
    expect(msToMinutes(d.breakMs)).toBe(45);
    expect(d.lastOut).toEqual(at('2026-09-27T19:10'));
    expect(d.open).toBe(false);
  });

  it('counts an open session up to now, and several sessions in one day', () => {
    const days = summarizeClock(
      [ev('in', '2026-09-27T08:00'), ev('out', '2026-09-27T10:00'), ev('in', '2026-09-27T11:00'), ev('break_start', '2026-09-27T12:00')],
      at('2026-09-27T12:30'),
      dateOf,
    );
    const d = days.get('2026-09-27')!;
    expect(msToMinutes(d.workedMs)).toBe(3 * 60);
    expect(msToMinutes(d.breakMs)).toBe(30);
    expect(d.open).toBe(true);
    expect(d.lastOut).toBeNull();
  });

  it('a night shift belongs to the day it started; clocking out from a break ends it', () => {
    const days = summarizeClock(
      [ev('in', '2026-09-27T22:00'), ev('break_start', '2026-09-28T02:00'), ev('out', '2026-09-28T02:30')],
      at('2026-09-28T09:00'),
      dateOf,
    );
    expect([...days.keys()]).toEqual(['2026-09-27']);
    expect(msToMinutes(days.get('2026-09-27')!.workedMs)).toBe(4 * 60);
    expect(msToMinutes(days.get('2026-09-27')!.breakMs)).toBe(30);
  });

  it('ignores events that make no sense', () => {
    const days = summarizeClock([ev('out', '2026-09-27T08:00'), ev('in', '2026-09-27T09:00'), ev('in', '2026-09-27T10:00'), ev('out', '2026-09-27T11:00')], at('2026-09-27T12:00'), dateOf);
    expect(msToMinutes(days.get('2026-09-27')!.workedMs)).toBe(120);
  });
});
