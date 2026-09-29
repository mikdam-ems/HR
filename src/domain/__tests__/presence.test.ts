import { describe, expect, it } from 'vitest';
import { type AttendanceDay, LATE_GRACE_MINUTES, type Presence, type PresenceInput, pastPresence, presence, summarizeAttendance } from '../presence';
import type { ResolvedDay } from '../types';

const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const workday: PresenceInput['day'] = {
  dayType: 'working',
  expectedMinutes: 510,
  schedule: { employeeId: 'rama', effectiveFrom: '2026-01-01', start: '09:00', end: '17:30' },
};
const nightShift: PresenceInput['day'] = {
  dayType: 'working',
  expectedMinutes: 480,
  schedule: { employeeId: 'hala', effectiveFrom: '2026-01-01', start: '22:00', end: '06:00' },
};
const weekend: PresenceInput['day'] = { ...workday, dayType: 'weekend' as ResolvedDay['dayType'], expectedMinutes: 0 };

const at = (now: string, over: Partial<PresenceInput> = {}): PresenceInput => ({
  day: workday,
  clockState: 'out',
  firstInMinutes: null,
  leavePortion: null,
  nowMinutes: m(now),
  ...over,
});

describe('presence', () => {
  it('shows who is working or on a break, whatever the day', () => {
    expect(presence(at('10:00', { clockState: 'working', firstInMinutes: m('08:55') }))).toEqual({ status: 'working', lateBy: 0 });
    expect(presence(at('13:10', { clockState: 'break', firstInMinutes: m('09:00') })).status).toBe('break');
    // Working on a weekend is still working.
    expect(presence(at('11:00', { day: weekend, clockState: 'working', firstInMinutes: m('10:00') })).status).toBe('working');
  });

  it('flags a late start after the grace period, and remembers it after they arrive', () => {
    expect(LATE_GRACE_MINUTES).toBe(15);
    expect(presence(at('10:00', { clockState: 'working', firstInMinutes: m('09:15') })).lateBy).toBe(0);
    expect(presence(at('10:00', { clockState: 'working', firstInMinutes: m('09:40') }))).toEqual({ status: 'working', lateBy: 40 });
    expect(presence(at('18:00', { firstInMinutes: m('09:40') }))).toEqual({ status: 'done', lateBy: 40 });
  });

  it('is "not in yet" before the shift, "late" once the grace period passes, "absent" after the shift ends', () => {
    expect(presence(at('08:30')).status).toBe('not_in');
    expect(presence(at('09:15')).status).toBe('not_in');
    expect(presence(at('09:16'))).toEqual({ status: 'late', lateBy: 16 });
    expect(presence(at('17:29')).status).toBe('late');
    expect(presence(at('17:30')).status).toBe('absent');
  });

  it('never calls someone on leave late or absent', () => {
    expect(presence(at('12:00', { leavePortion: 1 })).status).toBe('on_leave');
    expect(presence(at('18:00', { leavePortion: 1 })).status).toBe('on_leave');
    expect(presence(at('12:00', { leavePortion: 0.5 })).status).toBe('on_leave');
    // Came in for the afternoon half: working, not late.
    expect(presence(at('14:00', { leavePortion: 0.5, clockState: 'working', firstInMinutes: m('13:30') }))).toEqual({
      status: 'working',
      lateBy: 0,
    });
  });

  it('treats weekends, holidays and days with no assignment as off', () => {
    expect(presence(at('12:00', { day: weekend })).status).toBe('off');
    expect(presence(at('12:00', { day: { ...weekend, dayType: 'client_holiday' } })).status).toBe('off');
    expect(presence(at('12:00', { day: { dayType: 'unassigned', expectedMinutes: 0, schedule: null } })).status).toBe('off');
  });

  it('a Jordanian holiday while the client works is a workday', () => {
    expect(presence(at('12:00', { day: { ...workday, dayType: 'special_overtime' } })).status).toBe('late');
  });

  it('with no schedule, someone not clocked in is just "not in yet"', () => {
    expect(presence(at('20:00', { day: { ...workday, schedule: null } })).status).toBe('not_in');
  });

  it('a night shift is not late or absent during the day, only once it has started', () => {
    expect(presence(at('12:00', { day: nightShift })).status).toBe('not_in');
    expect(presence(at('22:30', { day: nightShift }))).toEqual({ status: 'late', lateBy: 30 });
    // Its end is tomorrow morning, so it can't be absent today.
    expect(presence(at('23:59', { day: nightShift })).status).toBe('late');
  });

  it('someone who clocked out is done for the day', () => {
    expect(presence(at('18:00', { firstInMinutes: m('09:00') }))).toEqual({ status: 'done', lateBy: 0 });
  });
});

describe('pastPresence', () => {
  const past = (over: Partial<PresenceInput> = {}) => {
    const { clockState: _c, nowMinutes: _n, ...rest } = at('00:00', over);
    return pastPresence(rest);
  };

  it('a workday with no clock-in and no leave is absent, never "late" or "not in yet"', () => {
    expect(past()).toEqual({ status: 'absent', lateBy: 0 });
    expect(past({ day: nightShift })).toEqual({ status: 'absent', lateBy: 0 });
  });

  it('keeps how late someone was, and leave and days off as they are', () => {
    expect(past({ firstInMinutes: m('09:40') })).toEqual({ status: 'done', lateBy: 40 });
    expect(past({ firstInMinutes: m('09:05') })).toEqual({ status: 'done', lateBy: 0 });
    expect(past({ leavePortion: 1 }).status).toBe('on_leave');
    expect(past({ day: weekend }).status).toBe('off');
  });
});

describe('summarizeAttendance', () => {
  it('adds up days in, late days and minutes, absences, forgotten clock-outs and places', () => {
    const d = (status: Presence['status'], lateBy = 0, place: AttendanceDay['place'] = null, forgotOut = false): AttendanceDay => ({
      presence: { status, lateBy },
      place,
      forgotOut,
    });
    expect(
      summarizeAttendance([
        d('done', 0, 'office'),
        d('done', 40, 'client_site', true),
        d('done', 20, 'client_site'),
        d('absent'),
        d('on_leave'),
        d('off'),
      ]),
    ).toEqual({
      daysIn: 3,
      lateDays: 2,
      lateMinutes: 60,
      absentDays: 1,
      forgotOut: 1,
      places: { office: 1, client_site: 2, remote: 0 },
    });
  });
});
