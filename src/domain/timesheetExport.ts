import type { MonthDay } from './timesheet';

/** Minutes per column of the official EMS timesheet (Client · PL · SL · PH · OT · SOT), plus other leave types. */
export interface ExportColumns {
  client: number;
  /** Personal (annual) leave. */
  pl: number;
  /** Sick leave. */
  sl: number;
  /** Any other leave type (hajj, unpaid, …); the type goes in the notes. */
  other: number;
  /** Public holiday: the client is off, so we are too. */
  ph: number;
  /** Hours beyond the day, and any work on a weekend or client holiday. */
  ot: number;
  /** Work on a Jordan holiday while the client works. */
  sot: number;
}

/** Splits one day into the columns Finance knows. `dayMinutes` is the person's full day (e.g. 510 = 8h30). */
export function exportColumns(d: MonthDay, dayMinutes: number): ExportColumns {
  const t = d.totals;
  const out: ExportColumns = { client: 0, pl: 0, sl: 0, other: 0, ph: 0, ot: t.regularOvertimeMinutes + t.offDayOvertimeMinutes, sot: t.specialOvertimeMinutes };
  if (d.day.dayType === 'client_holiday') out.ph = dayMinutes;
  if (d.day.dayType === 'working') out.client = t.workedMinutes - t.regularOvertimeMinutes;
  if (t.leaveDays) {
    const minutes = Math.round((d.day.expectedMinutes || dayMinutes) * t.leaveDays);
    const type = d.entry.leave?.type;
    if (type === 'annual') out.pl = minutes;
    else if (type === 'sick') out.sl = minutes;
    else out.other = minutes;
  }
  return out;
}
