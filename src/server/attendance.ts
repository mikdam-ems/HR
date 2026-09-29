import { and, asc, between, gte, isNotNull, lt } from 'drizzle-orm';
import type { DB } from '@/db';
import { clockEvents, type ClockEventRow, dayEntries, type Department, departments, type Employee, employees } from '@/db/schema';
import {
  type AttendanceDay,
  type AttendanceTotals,
  type WorkPlace,
  daysOfMonth,
  pastPresence,
  resolveDay,
  summarizeAttendance,
  summarizeClock,
  toMinutes,
} from '@/domain';
import { ammanInstant, timeOfDay, todayISO } from '@/lib/format';
import { firstClockDates } from './clock';
import { can, type CurrentUser } from './permissions';
import { loadRulesContext } from './rulesContext';
import { type Result, fail, ok } from './validation';

const DAY_MS = 24 * 3600_000;

export interface AttendanceDayRow extends AttendanceDay {
  date: string;
  firstIn: Date | null;
}

export interface AttendanceRow {
  employee: Employee;
  department: Department | null;
  /** Clients they were assigned to during the month. */
  clientIds: string[];
  /** False until they first clock in; their days before that aren't counted. */
  onClock: boolean;
  totals: AttendanceTotals;
  /** Finished days (before today) since they started using the clock. */
  days: AttendanceDayRow[];
}

export interface AttendanceMonth {
  year: number;
  month: number;
  rows: AttendanceRow[];
}

/** Each clock session's day (the day it began): where it was worked from and whether its clock-out was fixed later. */
function sessionsByDay(events: readonly ClockEventRow[]) {
  const out = new Map<string, { place: WorkPlace | null; corrected: boolean }>();
  let day: string | null = null;
  for (const e of events) {
    if (e.kind === 'in') {
      day = todayISO(e.at);
      const s = out.get(day) ?? { place: null, corrected: false };
      s.place ??= e.location;
      out.set(day, s);
    }
    if (e.kind === 'out' && day) {
      if (e.source === 'correction') out.get(day)!.corrected = true;
      day = null;
    }
  }
  return out;
}

/**
 * Late, absent and forgotten clock-outs per person for a month, using the same rule as the Today board on each
 * finished day. People not on the clock yet are listed but not counted, so they're never marked absent.
 */
export async function monthAttendanceReport(
  db: DB,
  actor: Pick<CurrentUser, 'roles'>,
  year: number,
  month: number,
  now = new Date(),
): Promise<Result<AttendanceMonth>> {
  if (!can(actor, 'reports.view')) return fail('forbidden');
  const days = daysOfMonth(year, month);
  const from = ammanInstant(days[0]!, '00:00');
  const to = new Date(ammanInstant(days[days.length - 1]!, '00:00').getTime() + 2 * DAY_MS);
  const today = todayISO(now);
  const [ctx, people, depts, events, leave, since] = await Promise.all([
    loadRulesContext(db),
    db.select().from(employees),
    db.select().from(departments),
    db.select().from(clockEvents).where(and(gte(clockEvents.at, from), lt(clockEvents.at, to))).orderBy(asc(clockEvents.at)),
    db
      .select()
      .from(dayEntries)
      .where(and(between(dayEntries.date, days[0]!, days[days.length - 1]!), isNotNull(dayEntries.leaveType))),
    firstClockDates(db),
  ]);
  const deptById = new Map(depts.map((d) => [d.id, d]));

  const rows: AttendanceRow[] = [];
  for (const employee of people.filter((p) => p.active).sort((a, b) => a.nameEn.localeCompare(b.nameEn))) {
    const resolved = days.map((d) => resolveDay(ctx, employee.id, d));
    if (resolved.every((d) => d.dayType === 'unassigned')) continue; // not working for anyone this month
    const mine = events.filter((e) => e.employeeId === employee.id);
    const clocked = summarizeClock(mine, now, todayISO);
    const sessions = sessionsByDay(mine);
    const first = since[employee.id] ?? null;
    const counted = first ? resolved.filter((d) => d.date >= first && d.date < today) : [];
    const dayRows = counted.map((day): AttendanceDayRow => {
      const c = clocked.get(day.date);
      const entry = leave.find((l) => l.employeeId === employee.id && l.date === day.date);
      const session = sessions.get(day.date);
      return {
        date: day.date,
        firstIn: c?.firstIn ?? null,
        presence: pastPresence({
          day,
          firstInMinutes: c ? toMinutes(timeOfDay(c.firstIn)) : null,
          leavePortion: entry?.leavePortion ?? null,
        }),
        place: session?.place ?? null,
        forgotOut: !!session?.corrected || !!c?.open,
      };
    });
    rows.push({
      employee,
      department: employee.departmentId ? (deptById.get(employee.departmentId) ?? null) : null,
      clientIds: [...new Set(resolved.flatMap((d) => d.clientIds))],
      onClock: !!first && first <= days[days.length - 1]!,
      totals: summarizeAttendance(dayRows),
      days: dayRows,
    });
  }
  return ok({ year, month, rows });
}
