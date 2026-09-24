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
