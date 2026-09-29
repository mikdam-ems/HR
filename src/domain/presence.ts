/**
 * Where someone stands today, for the Today board: working, not in yet, late, on leave, off…
 * Times are minutes after local midnight (Amman), so this stays free of time zones.
 */

import type { ClockState } from './clock';
import { toMinutes } from './dates';
import { isWorkday } from './timesheet';
import type { ResolvedDay } from './types';

export type PresenceStatus = 'working' | 'break' | 'done' | 'not_in' | 'late' | 'on_leave' | 'off' | 'absent';

/** Minutes after the shift starts before someone counts as late. A bus or a lift shouldn't flag anyone. */
export const LATE_GRACE_MINUTES = 15;

export interface PresenceInput {
  day: Pick<ResolvedDay, 'dayType' | 'expectedMinutes' | 'schedule'>;
  /** Right now, from the clock (a night shift that began yesterday is still "working"). */
  clockState: ClockState;
  /** Today's first clock-in, or null if they haven't clocked in today. */
  firstInMinutes: number | null;
  /** Leave taken today: 1 = full day, 0.5 = half day. */
  leavePortion: number | null;
  nowMinutes: number;
}

export interface Presence {
  status: PresenceStatus;
  /** How late they started (or, if still not in, how late they are so far). 0 when on time. */
  lateBy: number;
}

export function presence(input: PresenceInput): Presence {
  const { day, clockState, firstInMinutes, leavePortion, nowMinutes } = input;
  const expected = isWorkday(day.dayType) && day.expectedMinutes > 0;
  const schedule = expected ? day.schedule : null;
  const start = schedule ? toMinutes(schedule.start) : null;
  // A shift that ends at or before it starts finishes tomorrow, so it can't be missed today.
  const end = schedule && start !== null ? (toMinutes(schedule.end) > start ? toMinutes(schedule.end) : null) : null;
  // Half a day off may be the morning half, so arriving at noon isn't late.
  const lateBy = (at: number) => (start !== null && !leavePortion && at > start + LATE_GRACE_MINUTES ? at - start : 0);

  if (clockState === 'working' || clockState === 'break') {
    return { status: clockState, lateBy: firstInMinutes === null ? 0 : lateBy(firstInMinutes) };
  }
  if (firstInMinutes !== null) return { status: 'done', lateBy: lateBy(firstInMinutes) };
  if (leavePortion) return { status: 'on_leave', lateBy: 0 };
  if (!expected) return { status: 'off', lateBy: 0 };
  if (end !== null && nowMinutes >= end) return { status: 'absent', lateBy: 0 };
  const late = lateBy(nowMinutes);
  return late ? { status: 'late', lateBy: late } : { status: 'not_in', lateBy: 0 };
}

/**
 * A day that is over, for the monthly attendance report. Nobody is "not in yet" any more,
 * so a workday with no clock-in and no leave is absent.
 */
export function pastPresence(input: Omit<PresenceInput, 'clockState' | 'nowMinutes'>): Presence {
  const p = presence({ ...input, clockState: 'out', nowMinutes: 24 * 60 });
  return p.status === 'late' || p.status === 'not_in' ? { status: 'absent', lateBy: 0 } : p;
}

/** Where a day was worked from, as the person said at clock-in. */
export type WorkPlace = 'office' | 'client_site' | 'remote';

export interface AttendanceDay {
  presence: Presence;
  place: WorkPlace | null;
  /** They left the session open and closed it later (or still haven't). */
  forgotOut: boolean;
}

export interface AttendanceTotals {
  daysIn: number;
  lateDays: number;
  /** Total minutes late across the late days. */
  lateMinutes: number;
  absentDays: number;
  forgotOut: number;
  places: Record<WorkPlace, number>;
}

/** A month of finished days, added up for the report. */
export function summarizeAttendance(days: readonly AttendanceDay[]): AttendanceTotals {
  const totals: AttendanceTotals = {
    daysIn: 0,
    lateDays: 0,
    lateMinutes: 0,
    absentDays: 0,
    forgotOut: 0,
    places: { office: 0, client_site: 0, remote: 0 },
  };
  for (const d of days) {
    if (d.presence.status === 'done') totals.daysIn++;
    if (d.presence.status === 'absent') totals.absentDays++;
    if (d.presence.lateBy) {
      totals.lateDays++;
      totals.lateMinutes += d.presence.lateBy;
    }
    if (d.forgotOut) totals.forgotOut++;
    if (d.place && d.presence.status === 'done') totals.places[d.place]++;
  }
  return totals;
}
