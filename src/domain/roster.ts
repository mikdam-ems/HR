import { resolveDay } from './dayRules';
import type { ISODate, RulesContext } from './types';

export type RosterCell =
  | { kind: 'shift'; shiftId: string | null; start: string; end: string }
  | { kind: 'off' }
  | { kind: 'holiday' }
  | { kind: 'leave' }
  /** Not on this client that day. */
  | { kind: 'none' };

export interface RosterWeek {
  rows: { employeeId: string; cells: RosterCell[] }[];
  /** People working each shift on each day; custom hours (no shift) count under ''. */
  coverage: Record<string, number[]>;
}

/** Who works which shift on each of `days` for one client. */
export function rosterWeek(
  ctx: RulesContext,
  clientId: string,
  days: readonly ISODate[],
  onLeave: (employeeId: string, date: ISODate) => boolean,
): RosterWeek {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const ids = [
    ...new Set(
      ctx.assignments
        .filter((a) => a.clientId === clientId && a.start <= last && (a.end ?? '9999-12-31') >= first)
        .map((a) => a.employeeId),
    ),
  ];
  const coverage: Record<string, number[]> = {};
  const rows = ids.map((employeeId) => ({
    employeeId,
    cells: days.map((date, i): RosterCell => {
      const day = resolveDay(ctx, employeeId, date);
      if (!day.clientIds.includes(clientId)) return { kind: 'none' };
      if (day.dayType === 'client_holiday') return { kind: 'holiday' };
      if (!day.expectedMinutes || !day.schedule) return { kind: 'off' };
      if (onLeave(employeeId, date)) return { kind: 'leave' };
      const shiftId = day.schedule.clientShiftId ?? null;
      (coverage[shiftId ?? ''] ??= days.map(() => 0))[i]!++;
      return { kind: 'shift', shiftId, start: day.schedule.start, end: day.schedule.end };
    }),
  }));
  return { rows, coverage };
}
