import { isWithin, weekdayOf, windowMinutes } from './dates';
import type { Assignment, Holiday, ISODate, ResolvedDay, RulesContext, Schedule, SeasonalHours, WorkCalendar } from './types';

export function activeAssignments(ctx: RulesContext, employeeId: string, date: ISODate): Assignment[] {
  return ctx.assignments
    .filter((a) => a.employeeId === employeeId && isWithin(date, a.start, a.end))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The flagged primary assignment; otherwise the earliest-starting one. */
export function primaryAssignment(active: readonly Assignment[]): Assignment | null {
  return active.find((a) => a.primary) ?? active[0] ?? null;
}

/** The schedule in effect on a date: the latest one whose effectiveFrom is on or before it. */
export function scheduleOn(ctx: RulesContext, employeeId: string, date: ISODate): Schedule | null {
  let found: Schedule | null = null;
  for (const s of ctx.schedules) {
    if (s.employeeId !== employeeId || s.effectiveFrom > date) continue;
    if (!found || s.effectiveFrom > found.effectiveFrom) found = s;
  }
  return found;
}

/** The colleague someone swapped shifts with on this date, if an approved swap says so. */
export function swapPartner(ctx: RulesContext, employeeId: string, date: ISODate): string | null {
  const swap = ctx.swaps?.find((s) => s.date === date && (s.a === employeeId || s.b === employeeId));
  return swap ? (swap.a === employeeId ? swap.b : swap.a) : null;
}

/** The hours someone works on a date: their own schedule, or their swap partner's shift for that one day. */
export function workingScheduleOn(ctx: RulesContext, employeeId: string, date: ISODate): Schedule | null {
  const partner = swapPartner(ctx, employeeId, date);
  const theirs = partner ? scheduleOn(ctx, partner, date) : null;
  return theirs ? { ...theirs, employeeId } : scheduleOn(ctx, employeeId, date);
}

/** Seasonal hours at the person's primary client on this date that apply to their usual schedule, if any. */
export function seasonOn(ctx: RulesContext, clientId: string, usual: Schedule | null, date: ISODate): SeasonalHours | null {
  if (!usual) return null;
  return (
    ctx.seasonalHours?.find(
      (s) => s.clientId === clientId && isWithin(date, s.from, s.to) && (!s.clientShiftId || s.clientShiftId === usual.clientShiftId),
    ) ?? null
  );
}

export function scheduledMinutes(schedule: Schedule | null): number {
  if (!schedule) return 0;
  return Math.max(0, windowMinutes(schedule.start, schedule.end) - (schedule.breakMinutes ?? 0));
}

function calendarForClient(ctx: RulesContext, clientId: string): WorkCalendar {
  const client = ctx.clients[clientId];
  if (!client) throw new Error(`Unknown client "${clientId}"`);
  const calendar = ctx.calendars[client.calendarId];
  if (!calendar) throw new Error(`Client "${clientId}" has unknown calendar "${client.calendarId}"`);
  return calendar;
}

function holidayOn(calendar: WorkCalendar, date: ISODate): Holiday | undefined {
  return calendar.holidays.find((h) => h.date === date);
}

/** Works out what kind of day `date` is for one employee. See DayType for the rule order. */
export function resolveDay(ctx: RulesContext, employeeId: string, date: ISODate): ResolvedDay {
  const active = activeAssignments(ctx, employeeId, date);
  const primary = primaryAssignment(active);
  const usual = workingScheduleOn(ctx, employeeId, date);
  const partner = swapPartner(ctx, employeeId, date);
  // Ramadan (or other seasonal) hours at the primary client replace the usual hours for those days.
  const season = primary ? seasonOn(ctx, primary.clientId, usual, date) : null;
  const schedule: Schedule | null =
    season && usual ? { ...usual, start: season.start, end: season.end, breakMinutes: season.breakMinutes ?? 0 } : usual;
  const base = {
    date,
    employeeId,
    clientIds: active.map((a) => a.clientId),
    primaryClientId: primary?.clientId ?? null,
    schedule,
    ...(season ? { seasonName: season.name } : {}),
    ...(partner ? { swappedWith: partner } : {}),
  };

  if (!primary) return { ...base, dayType: 'unassigned', expectedMinutes: 0 };

  // Rule 1: a holiday at any assigned client makes it a day off.
  for (const a of active) {
    const holiday = holidayOn(calendarForClient(ctx, a.clientId), date);
    if (holiday) return { ...base, dayType: 'client_holiday', holidayName: holiday.name, holidayNameAr: holiday.nameAr, expectedMinutes: 0 };
  }

  // Rule 2: the primary client's work week decides weekends.
  if (!calendarForClient(ctx, primary.clientId).workWeek.includes(weekdayOf(date))) {
    return { ...base, dayType: 'weekend', expectedMinutes: 0 };
  }

  const expectedMinutes = scheduledMinutes(schedule);

  // Rule 3: client is working but it's a home (Jordan) holiday → worked hours are special overtime.
  const homeHoliday = holidayOn(ctx.homeCalendar, date);
  if (homeHoliday) {
    return {
      ...base,
      dayType: 'special_overtime',
      holidayName: homeHoliday.name,
      holidayNameAr: homeHoliday.nameAr,
      expectedMinutes,
    };
  }

  // Rule 4: normal working day.
  return { ...base, dayType: 'working', expectedMinutes };
}
