import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { DB } from '@/db';
import { clockEvents } from '@/db/schema';
import { type ClockDay, type ClockKind, type ClockState, canClock, daysOfMonth, stateAfter, summarizeClock } from '@/domain';
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
export async function clockView(db: DB, employeeId: string, now = new Date()): Promise<ClockView> {
  const events = await db
    .select()
    .from(clockEvents)
    .where(and(eq(clockEvents.employeeId, employeeId), gte(clockEvents.at, new Date(now.getTime() - 3 * DAY_MS))))
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

/** Clocked time per day of a month (sessions belong to the day they started). */
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
  const out: Record<string, ClockDay> = {};
  for (const d of days) if (all.has(d)) out[d] = all.get(d)!;
  return out;
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
