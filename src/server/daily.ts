import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { auditLog, clockEvents, employees, notifications } from '@/db/schema';
import { addDays, daysOfMonth, resolveDay, stateAfter, toMinutes } from '@/domain';
import { ammanInstant, todayISO } from '@/lib/format';
import { audit } from './audit';
import { celebrations } from './celebrations';
import { notify, siteUrl, slackPost } from './notify';
import { loadRulesContext } from './rulesContext';
import { monthStatus } from './timesheets';

export interface DailyReport {
  reminded: number;
  /** People told they left a clock session open. */
  nudged: number;
  celebrations: number;
  posted: boolean;
}

/** The once-a-day jobs, run by Vercel Cron in the morning (Amman time). Safe to run twice on the same day. */
export async function runDaily(db: DB, now = new Date()): Promise<DailyReport> {
  const today = todayISO(now);
  const reminded = await remindTimesheets(db, today);
  const nudged = await nudgeOpenSessions(db, now);
  const parties = await celebrations(db, today, 1);
  const posted = parties.length ? await postCelebrations(db, today, parties) : false;
  return { reminded, nudged, celebrations: parties.length, posted };
}

/** A night shift may legitimately still be running; wait this long after its scheduled end before nudging. */
const NUDGE_AFTER_SHIFT_MS = 60 * 60_000;
/** How far back to look for a forgotten session. Older ones were nudged already, or predate the clock. */
const OPEN_SESSION_LOOKBACK_MS = 14 * 24 * 3600_000;

/**
 * Tells people who are still clocked in from an earlier day, once per forgotten session, so the day's hours
 * don't run on into overtime nobody worked. The notification links to Home, where they enter when they left.
 */
async function nudgeOpenSessions(db: DB, now: Date): Promise<number> {
  const today = todayISO(now);
  const [ctx, people, events, already] = await Promise.all([
    loadRulesContext(db),
    db.select({ id: employees.id }).from(employees).where(eq(employees.active, true)),
    db
      .select()
      .from(clockEvents)
      .where(gte(clockEvents.at, new Date(now.getTime() - OPEN_SESSION_LOOKBACK_MS)))
      .orderBy(asc(clockEvents.at)),
    db
      .select({ employeeId: notifications.employeeId, data: notifications.data })
      .from(notifications)
      .where(eq(notifications.kind, 'clock_open')),
  ]);
  const told = new Set(already.map((n) => `${n.employeeId}:${(n.data as { date?: string }).date}`));
  let nudged = 0;
  for (const { id } of people) {
    const mine = events.filter((e) => e.employeeId === id);
    if (stateAfter(mine).state === 'out') continue;
    const lastIn = [...mine].reverse().find((e) => e.kind === 'in');
    const date = lastIn ? todayISO(lastIn.at) : null;
    if (!date || date >= today || told.has(`${id}:${date}`)) continue;
    const schedule = resolveDay(ctx, id, date).schedule;
    if (schedule) {
      const overnight = toMinutes(schedule.end) <= toMinutes(schedule.start);
      const shiftEnd = ammanInstant(overnight ? addDays(date, 1) : date, schedule.end);
      if (now.getTime() < shiftEnd.getTime() + NUDGE_AFTER_SHIFT_MS) continue;
    }
    await notify(db, [id], 'clock_open', { date }, '/');
    nudged++;
  }
  return nudged;
}

/**
 * On each person's last working day of the month, reminds them to submit the month if they haven't.
 * "Working day" follows their own client calendar and schedule, so a Sunday–Thursday team is reminded on
 * the last Thursday and a Hala shift worker on their own last shift.
 */
async function remindTimesheets(db: DB, today: string): Promise<number> {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const monthKey = today.slice(0, 7);
  const [ctx, people, already] = await Promise.all([
    loadRulesContext(db),
    db.select().from(employees).where(eq(employees.active, true)),
    db
      .select({ employeeId: notifications.employeeId })
      .from(notifications)
      .where(and(eq(notifications.kind, 'timesheet_reminder'), sql`${notifications.data}->>'month' = ${monthKey}`)),
  ]);
  const done = new Set(already.map((r) => r.employeeId));
  const due: string[] = [];
  for (const p of people) {
    if (done.has(p.id)) continue;
    const lastWorking = daysOfMonth(year, month)
      .filter((d) => resolveDay(ctx, p.id, d).expectedMinutes > 0)
      .at(-1);
    if (lastWorking !== today) continue;
    const status = await monthStatus(db, p.id, year, month);
    if (status === 'draft' || status === 'returned') due.push(p.id);
  }
  await notify(db, due, 'timesheet_reminder', { month: monthKey }, `/timesheet?month=${monthKey}`);
  return due.length;
}

/** Posts today's birthdays and work anniversaries to the team channel (never ages, never who is off). */
async function postCelebrations(db: DB, today: string, parties: Awaited<ReturnType<typeof celebrations>>) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CELEBRATIONS_CHANNEL;
  if (!token || !channel) return false;
  // Cron can fire twice; the audit log remembers that today's post went out.
  const sent = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'celebrations_post'), eq(auditLog.entityId, today)));
  if (sent.length) return false;
  const lines = parties.map((c) => {
    const who = c.person.slackUserId ? `<@${c.person.slackUserId}>` : `*${c.person.nameEn}*`;
    return c.kind === 'birthday'
      ? `🎂 Happy birthday, ${who}!`
      : `🎉 ${who} celebrates ${c.years} ${c.years === 1 ? 'year' : 'years'} at EMS today — thank you!`;
  });
  const ok = await slackPost(token, channel, `${lines.join('\n')}\n<${siteUrl()}/|People & Culture>`);
  if (ok) await audit(db, { actorId: null, action: 'post', entity: 'celebrations_post', entityId: today, after: { lines } });
  return ok;
}
