import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { DB } from '@/db';
import { clockEvents, dayEntries, type Employee, leaveRequests, type WorkLocation } from '@/db/schema';
import { type Presence, type ResolvedDay, isWorkday, presence, resolveDay, stateAfter, summarizeClock, toMinutes } from '@/domain';
import { timeOfDay, todayISO } from '@/lib/format';
import { loadRulesContext } from './rulesContext';

const DAY_MS = 24 * 3600_000;
const NO_IDS = ['00000000-0000-0000-0000-000000000000'];

export interface BoardRow {
  employee: Employee;
  day: ResolvedDay;
  presence: Presence;
  /** When they started working or went on a break (for "since 09:05"). */
  since: Date | null;
  /** Today's first clock-in. */
  firstIn: Date | null;
  /** Where today's session is being worked from, when they said. */
  location: WorkLocation | null;
  /** 1 or 0.5 when they have leave today. */
  leavePortion: number | null;
}

/** Where each of these people stands today. One read of the clock, leave and rules for everyone. */
export async function todayBoard(db: DB, people: readonly Employee[], now = new Date()): Promise<BoardRow[]> {
  const today = todayISO(now);
  const ids = people.length ? people.map((p) => p.id) : NO_IDS;
  const [ctx, events, leave, dayLeave] = await Promise.all([
    loadRulesContext(db),
    db
      .select()
      .from(clockEvents)
      .where(and(inArray(clockEvents.employeeId, ids), gte(clockEvents.at, new Date(now.getTime() - 2 * DAY_MS))))
      .orderBy(asc(clockEvents.at)),
    db
      .select()
      .from(leaveRequests)
      .where(
        and(
          inArray(leaveRequests.employeeId, ids),
          eq(leaveRequests.status, 'approved'),
          lte(leaveRequests.fromDate, today),
          gte(leaveRequests.toDate, today),
        ),
      ),
    // Leave can also be entered straight on the timesheet.
    db
      .select()
      .from(dayEntries)
      .where(and(inArray(dayEntries.employeeId, ids), eq(dayEntries.date, today), isNotNull(dayEntries.leaveType))),
  ]);
  const nowMinutes = toMinutes(timeOfDay(now));

  return people.map((employee) => {
    const mine = events.filter((e) => e.employeeId === employee.id);
    const { state, since } = stateAfter(mine);
    const clocked = summarizeClock(mine, now, todayISO).get(today);
    const day = resolveDay(ctx, employee.id, today);
    const request = leave.find((l) => l.employeeId === employee.id);
    const entry = dayLeave.find((d) => d.employeeId === employee.id);
    // Leave only counts on a day they'd have worked; a weekend inside a leave range is still a weekend.
    const leavePortion = isWorkday(day.dayType) ? (entry?.leavePortion ?? (request ? (request.halfDay ? 0.5 : 1) : null)) : null;
    const lastIn = [...mine].reverse().find((e) => e.kind === 'in');
    const inToday = state !== 'out' || (lastIn && todayISO(lastIn.at) === today);
    return {
      employee,
      day,
      presence: presence({
        day,
        clockState: state,
        firstInMinutes: clocked ? toMinutes(timeOfDay(clocked.firstIn)) : null,
        leavePortion,
        nowMinutes,
      }),
      since: state === 'out' ? null : since,
      firstIn: clocked?.firstIn ?? null,
      location: inToday ? (lastIn?.location ?? null) : null,
      leavePortion,
    };
  });
}
