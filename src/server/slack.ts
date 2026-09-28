import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { employees } from '@/db/schema';
import { type ClockKind, msToMinutes } from '@/domain';
import { formatHours, timeOfDay } from '@/lib/format';
import { type ClockView, clock, clockView } from './clock';

/**
 * Slack slash commands: `/ems in`, `/ems break`, `/ems back`, `/ems out`, `/ems status` (and `/in`, `/out`, … if
 * the Slack app defines them). Replies are only visible to the person who typed the command.
 */

/** Slack signs every request; reject anything unsigned, tampered with, or older than five minutes. */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 60 * 5) return false;
  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SlackAction = ClockKind | 'status' | 'help';

const WORDS: Record<string, SlackAction> = {
  in: 'in', start: 'in', on: 'in',
  out: 'out', off: 'out', stop: 'out', bye: 'out',
  break: 'break_start', pause: 'break_start', lunch: 'break_start',
  back: 'break_end', resume: 'break_end',
  status: 'status', '': 'status', help: 'help',
};

/** What the person asked for: `/ems in` → in; `/in` → in; `/break` → break_start. */
export function parseCommand(command: string, text: string): SlackAction {
  const name = command.replace(/^\//, '').toLowerCase();
  const word = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (name && name in WORDS) return WORDS[name]!;
  return WORDS[word] ?? 'help';
}

export const HELP = [
  '*EMS clock*',
  '`/ems in` — clock in',
  '`/ems break` — start a break',
  '`/ems back` — back from a break',
  '`/ems out` — clock out',
  '`/ems status` — how long you’ve worked today',
].join('\n');

const worked = (v: ClockView) => formatHours(msToMinutes(v.today.workedMs));
const breaks = (v: ClockView) => (v.today.breakMs >= 60_000 ? ` (breaks ${formatHours(msToMinutes(v.today.breakMs))})` : '');

/** The reply text for a state after an action (or for `status`). */
export function describe(action: SlackAction, v: ClockView): string {
  const at = timeOfDay(v.now);
  if (v.openFrom) {
    return `⚠️ You're still clocked in from ${v.openFrom.date}. Open the People & Culture app and enter when you left that day, then clock in again.`;
  }
  switch (action) {
    case 'in':
      return `✅ Clocked in at ${at}. Have a good day!`;
    case 'break_start':
      return `☕ Break started at ${at} · ${worked(v)} worked so far. Type \`/ems back\` when you return.`;
    case 'break_end':
      return `💪 Back at ${at} · ${worked(v)} worked so far${breaks(v)}.`;
    case 'out':
      return `👋 Clocked out at ${at} · ${worked(v)} today${breaks(v)}. See you tomorrow!`;
    default:
      if (v.state === 'working') return `🟢 Working since ${v.since ? timeOfDay(v.since) : at} · ${worked(v)} today${breaks(v)}.`;
      if (v.state === 'break') return `☕ On a break since ${v.since ? timeOfDay(v.since) : at} · ${worked(v)} worked today.`;
      return v.today.workedMs ? `⚪ Clocked out · ${worked(v)} today${breaks(v)}.` : '⚪ Not clocked in today. Type `/ems in` to start.';
  }
}

/** Why an action doesn't fit the current state, in plain words. */
function refusal(action: ClockKind, v: ClockView): string {
  if (action === 'in') return `You're already clocked in (${worked(v)} today).`;
  if (action === 'out' || action === 'break_start') return "You're not clocked in. Type `/ems in` first.";
  return v.state === 'working' ? "You're not on a break." : "You're not clocked in. Type `/ems in` first.";
}

/** Finds the person behind a Slack user: by the remembered id, else by their Slack email (then remembers it). */
export async function employeeForSlackUser(
  db: DB,
  slackUserId: string,
  lookupEmail: (id: string) => Promise<string | null>,
) {
  const [known] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.slackUserId, slackUserId), eq(employees.active, true)));
  if (known) return known;
  const email = (await lookupEmail(slackUserId))?.toLowerCase();
  if (!email) return null;
  const [byEmail] = await db.select().from(employees).where(and(eq(employees.email, email), eq(employees.active, true)));
  if (!byEmail) return null;
  await db.update(employees).set({ slackUserId }).where(eq(employees.id, byEmail.id));
  return byEmail;
}

/** Runs a slash command for a person and returns the reply text. */
export async function runSlackCommand(db: DB, employeeId: string, action: SlackAction, now = new Date()): Promise<string> {
  if (action === 'help') return HELP;
  if (action === 'status') return describe('status', await clockView(db, employeeId, now));

  let kind: ClockKind = action;
  const before = await clockView(db, employeeId, now);
  if (before.openFrom) return describe(action, before);
  // "/ems in" during a break means "I'm back".
  if (kind === 'in' && before.state === 'break') kind = 'break_end';
  const result = await clock(db, employeeId, kind, now, 'slack');
  if (!result.ok) return refusal(kind, before);
  return describe(kind, await clockView(db, employeeId, now));
}

/** Slack's users.info, for the email behind a Slack user (needs the users:read.email scope). */
export async function slackEmail(slackUserId: string, token: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const json = (await res.json()) as { ok: boolean; user?: { profile?: { email?: string } } };
  return json.ok ? (json.user?.profile?.email ?? null) : null;
}
