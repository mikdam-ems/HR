import { cache } from 'react';
import { and, asc, desc, eq, gte, inArray, lt, min } from 'drizzle-orm';
import type { DB } from '@/db';
import { clockEvents } from '@/db/schema';
import { type ClockDay, type ClockKind, type ClockState, canClock, daysOfMonth, msToMinutes, stateAfter, summarizeClock } from '@/domain';
import { ammanInstant, todayISO } from '@/lib/format';
import { audit } from './audit';
import { type Result, fail, ok } from './validation';

const DAY_MS = 24 * 3600_000;
const dateOf = (d: Date) => todayISO(d);

async function lastEvent(db: DB, employeeId: string) {
  const [row] = await db
    .select()
    .from(clockEvents)
    .where(eq(clockEvents.employeeId, employeeId))
    .orderBy(desc(clockEvents.at))
    .limit(1);
  return row;
}

/** Clock in, start or end a break, or clock out — only when it follows from the current state. */
export async function clock(
  db: DB,
  actorId: string,
  kind: ClockKind,
  now = new Date(),
  source = 'web',
): Promise<Result<void>> {
  const last = await lastEvent(db, actorId);
  const state = stateAfter(last ? [last] : []).state;
  if (!canClock(state, kind)) return fail('clock_invalid', `${state} → ${kind}`);
  // A session left open from an earlier day must be closed with the real leaving time first.
  if (last && state !== 'out' && kind !== 'out' && (await openSince(db, actorId)) !== todayISO(now)) {
    return fail('clock_invalid', 'close the open session first');
  }
  const at = last && last.at >= now ? new Date(last.at.getTime() + 1000) : now;
  const [row] = await db.insert(clockEvents).values({ employeeId: actorId, kind, at, source }).returning();
  await audit(db, { actorId, action: kind, entity: 'clock', entityId: row!.id, after: row });
  return ok(undefined);
}

/** The date the current open session started on (null when clocked out). */
async function openSince(db: DB, employeeId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(clockEvents)
    .where(eq(clockEvents.employeeId, employeeId))
    .orderBy(desc(clockEvents.at))
    .limit(50);
  const lastIn = rows.find((r) => r.kind === 'in');
  const state = stateAfter(rows.length ? [rows[0]!] : []).state;
  return state === 'out' || !lastIn ? null : dateOf(lastIn.at);
}

/** Closes a forgotten session at the time the person says they left (on the day the session began, or the next). */
export async function clockOutAt(db: DB, actorId: string, date: string, time: string, now = new Date()): Promise<Result<void>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return fail('invalid_input');
  const last = await lastEvent(db, actorId);
  if (!last || stateAfter([last]).state === 'out') return fail('clock_invalid', 'not clocked in');
  const at = ammanInstant(date, time);
  if (at <= last.at || at > now) return fail('clock_invalid', 'time must be after your last clock event and not in the future');
  const [row] = await db.insert(clockEvents).values({ employeeId: actorId, kind: 'out', at, source: 'correction' }).returning();
  await audit(db, { actorId, action: 'out_correction', entity: 'clock', entityId: row!.id, after: row });
  return ok(undefined);
}

export interface ClockView {
  state: ClockState;
  /** When the current state began. */
  since: Date | null;
  /** Today's totals so far (ms), counted up to `now`. */
  today: { workedMs: number; breakMs: number; firstIn: Date | null };
  /** Set when a session from an earlier day is still open (a forgotten clock-out). */
  openFrom: { date: string; at: Date } | null;
  now: Date;
}

/** Everything the clock widget needs for one person. */
async function clockViewUncached(db: DB, employeeId: string, now = new Date()): Promise<ClockView> {
  // Three days covers today and a night shift; reach back further only for a session still open from before,
  // otherwise it looks like "clocked out" while the server refuses a new clock-in.
  const recent = new Date(now.getTime() - 3 * DAY_MS);
  const openDate = await openSince(db, employeeId);
  const openStart = openDate ? ammanInstant(openDate, '00:00') : null;
  const from = openStart && openStart < recent ? openStart : recent;
  const events = await db
    .select()
    .from(clockEvents)
    .where(and(eq(clockEvents.employeeId, employeeId), gte(clockEvents.at, from)))
    .orderBy(asc(clockEvents.at));
  const { state, since } = stateAfter(events);
  const days = summarizeClock(events, now, dateOf);
  const today = days.get(todayISO(now));
  const open = [...days.values()].find((d) => d.open);
  return {
    state,
    since,
    today: { workedMs: today?.workedMs ?? 0, breakMs: today?.breakMs ?? 0, firstIn: today?.firstIn ?? null },
    openFrom: open && open.date !== todayISO(now) ? { date: open.date, at: open.firstIn } : null,
    now,
  };
}

/** Clocked time per day of a month with each day's events (sessions belong to the day they started). */
export async function monthClock(db: DB, employeeId: string, year: number, month: number, now = new Date()) {
  const days = daysOfMonth(year, month);
  const from = ammanInstant(days[0]!, '00:00');
  const to = new Date(ammanInstant(days[days.length - 1]!, '00:00').getTime() + 2 * DAY_MS);
  const events = await db
    .select()
    .from(clockEvents)
    .where(and(eq(clockEvents.employeeId, employeeId), gte(clockEvents.at, from), lt(clockEvents.at, to)))
    .orderBy(asc(clockEvents.at));
  const all = summarizeClock(events, now, dateOf);
  const out: Record<string, ClockDay<(typeof events)[number]>> = {};
  for (const d of days) if (all.has(d)) out[d] = all.get(d)!;
  return out;
}

/** Clocked minutes per day, and the days whose session is still open — what a timesheet needs from the clock. */
export interface ClockedMonth {
  minutes: Record<string, number>;
  open: string[];
}

/** Turns a month of clock days into what a timesheet needs. */
export function toClockedMonth(days: Record<string, ClockDay>): ClockedMonth {
  const minutes: Record<string, number> = {};
  const open: string[] = [];
  for (const [date, d] of Object.entries(days)) {
    minutes[date] = msToMinutes(d.workedMs);
    if (d.open) open.push(date);
  }
  return { minutes, open };
}

/** Clocked time per person per day for a whole month, in one query (for reports). */
export async function monthClockMinutes(db: DB, year: number, month: number, now = new Date()): Promise<Record<string, ClockedMonth>> {
  const days = daysOfMonth(year, month);
  const from = ammanInstant(days[0]!, '00:00');
  const to = new Date(ammanInstant(days[days.length - 1]!, '00:00').getTime() + 2 * DAY_MS);
  const events = await db
    .select()
    .from(clockEvents)
    .where(and(gte(clockEvents.at, from), lt(clockEvents.at, to)))
    .orderBy(asc(clockEvents.at));
  const byPerson = new Map<string, typeof events>();
  for (const e of events) {
    const list = byPerson.get(e.employeeId);
    if (list) list.push(e);
    else byPerson.set(e.employeeId, [e]);
  }
  const out: Record<string, ClockedMonth> = {};
  for (const [id, list] of byPerson) {
    const summary = summarizeClock(list, now, dateOf);
    const inMonth: Record<string, ClockDay> = {};
    for (const d of days) if (summary.has(d)) inMonth[d] = summary.get(d)!;
    out[id] = toClockedMonth(inMonth);
  }
  return out;
}

/** The first day each person clocked in (the day the clock takes over their timesheet). */
export async function firstClockDates(db: DB, ids?: string[]): Promise<Record<string, string>> {
  const rows = await db
    .select({ employeeId: clockEvents.employeeId, first: min(clockEvents.at) })
    .from(clockEvents)
    .where(ids ? inArray(clockEvents.employeeId, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined)
    .groupBy(clockEvents.employeeId);
  return Object.fromEntries(rows.filter((r) => r.first).map((r) => [r.employeeId, dateOf(new Date(r.first!))]));
}

/** Current state of several people, for "who's working now". */
export async function teamClock(db: DB, ids: string[]): Promise<Record<string, { state: ClockState; since: Date | null }>> {
  if (!ids.length) return {};
  const rows = await db
    .select()
    .from(clockEvents)
    .where(and(inArray(clockEvents.employeeId, ids), gte(clockEvents.at, new Date(Date.now() - 2 * DAY_MS))))
    .orderBy(asc(clockEvents.at));
  const out: Record<string, { state: ClockState; since: Date | null }> = {};
  for (const id of ids) out[id] = stateAfter(rows.filter((r) => r.employeeId === id));
  return out;
}

/** Loaded once per page render and shared by everything on the page. */
export const clockView = cache(clockViewUncached);
