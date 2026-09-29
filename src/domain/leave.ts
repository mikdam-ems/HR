import { completedYears, eachDay } from './dates';
import { resolveDay } from './dayRules';
import { isWorkday } from './timesheet';
import type { ISODate, RulesContext } from './types';

/**
 * Annual leave policy. Defaults follow our reading of Jordanian labour law
 * (14 working days, 21 after 5 years with the same employer) — HR to confirm.
 */
export interface AnnualLeavePolicy {
  baseDays: number;
  seniorDays: number;
  seniorAfterYears: number;
}

export const JORDAN_ANNUAL_LEAVE: AnnualLeavePolicy = { baseDays: 14, seniorDays: 21, seniorAfterYears: 5 };

export function annualEntitlementDays(
  hireDate: ISODate,
  onDate: ISODate,
  policy: AnnualLeavePolicy = JORDAN_ANNUAL_LEAVE,
): number {
  return completedYears(hireDate, onDate) >= policy.seniorAfterYears ? policy.seniorDays : policy.baseDays;
}

/**
 * How many leave days a request uses. Weekends and client holidays in the range are free;
 * a Jordanian-holiday workday (special overtime day) is a workday, so it does count.
 * A half day is only allowed for a single-day request.
 */
export function countLeaveDays(
  ctx: RulesContext,
  employeeId: string,
  from: ISODate,
  to: ISODate,
  options: { halfDay?: boolean } = {},
): number {
  if (to < from) throw new Error('Leave ends before it starts');
  if (options.halfDay && from !== to) throw new Error('A half day must be a single date');
  const workdays = eachDay(from, to).filter((d) => isWorkday(resolveDay(ctx, employeeId, d).dayType)).length;
  return options.halfDay ? workdays * 0.5 : workdays;
}

export interface BalanceInput {
  entitlement: number;
  carriedOver: number;
  taken: number;
  pending: number;
  /** Manual HR adjustments, positive or negative. */
  adjustments: number;
}

/** Days still free to request: entitlement + carry-over + adjustments − taken − pending. */
export function availableBalance(b: BalanceInput): number {
  return b.entitlement + b.carriedOver + b.adjustments - b.taken - b.pending;
}

export interface LeaveRequestSpan {
  fromDate: ISODate;
  toDate: ISODate;
  status: string;
  type: string;
}

export interface LeaveCalendarMarks {
  /** Days already covered by a pending or approved request — not bookable again. */
  booked: Record<ISODate, { status: 'pending' | 'approved'; type: string }>;
  /** Days off anyway (weekend or client holiday), which leave doesn't use. */
  off: Record<ISODate, { kind: 'weekend' | 'holiday'; name?: string; nameAr?: string }>;
}

/** What the time-off calendar colours for one person between `from` and `to`. */
export function leaveCalendarMarks(
  ctx: RulesContext,
  employeeId: string,
  from: ISODate,
  to: ISODate,
  requests: readonly LeaveRequestSpan[],
): LeaveCalendarMarks {
  const booked: LeaveCalendarMarks['booked'] = {};
  for (const r of requests) {
    if (r.status !== 'pending' && r.status !== 'approved') continue;
    const start = r.fromDate > from ? r.fromDate : from;
    const end = r.toDate < to ? r.toDate : to;
    if (start > end) continue;
    for (const d of eachDay(start, end)) {
      if (booked[d]?.status === 'approved') continue;
      booked[d] = { status: r.status, type: r.type };
    }
  }
  const off: LeaveCalendarMarks['off'] = {};
  for (const d of eachDay(from, to)) {
    const day = resolveDay(ctx, employeeId, d);
    if (day.dayType === 'weekend') off[d] = { kind: 'weekend' };
    else if (day.dayType === 'client_holiday') {
      off[d] = { kind: 'holiday', ...(day.holidayName ? { name: day.holidayName } : {}), ...(day.holidayNameAr ? { nameAr: day.holidayNameAr } : {}) };
    }
  }
  return { booked, off };
}
