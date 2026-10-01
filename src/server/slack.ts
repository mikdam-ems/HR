import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { employees, type WorkLocation } from '@/db/schema';
import { type ClockKind, msToMinutes } from '@/domain';
import { formatDate, formatHours, timeOfDay } from '@/lib/format';
import { type ClockView, clock, clockView } from './clock';
import { siteUrl } from './notify';

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

/** `/ems in remote`, `/ems in site`, `/ems in office` (and a few everyday words for each). */
const PLACES: Record<string, WorkLocation> = {
  office: 'office', ems: 'office',
  site: 'client_site', client: 'client_site', onsite: 'client_site',
  remote: 'remote', home: 'remote', wfh: 'remote',
};

const PLACE_NAMES: Record<WorkLocation, string> = { office: 'Office', client_site: 'Client site', remote: 'Remote' };

/** Where the person says they're working, if they said: `/ems in remote` → remote. */
export function parseLocation(text: string): WorkLocation | null {
  for (const word of text.trim().toLowerCase().split(/[\s-]+/)) if (word in PLACES) return PLACES[word]!;
  return null;
}

/**
 * How replies speak: the command the person typed (`/ems` or `/kadr`, both work), so hints match what they use,
 * and the site to link to.
 */
export interface ReplyOptions {
  command?: string;
  appUrl?: string;
}

/** The command to show in hints. Direct ones like `/in` are an action themselves, so hints then use `/ems`. */
function commandOf(o: ReplyOptions): string {
  const name = o.command?.replace(/^\//, '').toLowerCase() ?? '';
  return /^[a-z]+$/.test(name) && !(name in WORDS) ? `/${name}` : '/ems';
}

export function helpText(o: ReplyOptions = {}): string {
  const c = commandOf(o);
  return [
    '*Clock commands*',
    `\`${c} in\` — clock in (add \`office\`, \`site\` or \`remote\` to say where; otherwise your last choice is kept)`,
    `\`${c} break\` — start a break`,
    `\`${c} back\` — back from a break`,
    `\`${c} out\` — clock out`,
    `\`${c} status\` — how long you’ve worked today`,
  ].join('\n');
}

const worked = (v: ClockView) => formatHours(msToMinutes(v.today.workedMs));
const breaks = (v: ClockView) => (v.today.breakMs >= 60_000 ? ` (breaks ${formatHours(msToMinutes(v.today.breakMs))})` : '');

/** The reply text for a state after an action (or for `status`). */
export function describe(action: SlackAction, v: ClockView, o: ReplyOptions = {}): string {
  const at = timeOfDay(v.now);
  const c = commandOf(o);
  if (v.openFrom) {
    // The Home page asks "When did you leave that day?" for exactly this case, so link straight to it.
    const day = formatDate(v.openFrom.date, 'en', { weekday: 'short', day: 'numeric', month: 'short' });
    const home = `${o.appUrl ?? siteUrl()}/`;
    return `⚠️ You're still clocked in from ${day}. <${home}|Open the app> and enter when you left that day, then clock in again.`;
  }
  switch (action) {
    case 'in':
      return `✅ Clocked in at ${at}${v.location ? ` · ${PLACE_NAMES[v.location]}` : ''}. Have a good day!`;
    case 'break_start':
      return `☕ Break started at ${at} · ${worked(v)} worked so far. Type \`${c} back\` when you return.`;
    case 'break_end':
      return `💪 Back at ${at} · ${worked(v)} worked so far${breaks(v)}.`;
    case 'out':
      return `👋 Clocked out at ${at} · ${worked(v)} today${breaks(v)}. See you tomorrow!`;
    default:
      if (v.state === 'working') {
        const place = v.location ? ` · ${PLACE_NAMES[v.location]}` : '';
        return `🟢 Working since ${v.since ? timeOfDay(v.since) : at}${place} · ${worked(v)} today${breaks(v)}.`;
      }
      if (v.state === 'break') return `☕ On a break since ${v.since ? timeOfDay(v.since) : at} · ${worked(v)} worked today.`;
      return v.today.workedMs ? `⚪ Clocked out · ${worked(v)} today${breaks(v)}.` : `⚪ Not clocked in today. Type \`${c} in\` to start.`;
  }
}

/** Why an action doesn't fit the current state, in plain words. */
function refusal(action: ClockKind, v: ClockView, o: ReplyOptions): string {
  const notIn = `You're not clocked in. Type \`${commandOf(o)} in\` first.`;
  if (action === 'in') return `You're already clocked in (${worked(v)} today).`;
  if (action === 'out' || action === 'break_start') return notIn;
  return v.state === 'working' ? "You're not on a break." : notIn;
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
export async function runSlackCommand(
  db: DB,
  employeeId: string,
  action: SlackAction,
  now = new Date(),
  location: WorkLocation | null = null,
  options: ReplyOptions = {},
): Promise<string> {
  if (action === 'help') return helpText(options);
  if (action === 'status') return describe('status', await clockView(db, employeeId, now), options);

  let kind: ClockKind = action;
  const before = await clockView(db, employeeId, now);
  if (before.openFrom) return describe(action, before, options);
  // "/ems in" during a break means "I'm back".
  if (kind === 'in' && before.state === 'break') kind = 'break_end';
  const result = await clock(db, employeeId, kind, now, 'slack', location);
  if (!result.ok) return refusal(kind, before, options);
  return describe(kind, await clockView(db, employeeId, now), options);
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

/** Slack's response_url for a command. Only its own https hooks host is trusted, since we post the reply there. */
export function isSlackResponseUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'hooks.slack.com';
  } catch {
    return false;
  }
}

/** Sends a command's reply to its response_url; only the person who typed the command sees it. */
export async function postSlackReply(responseUrl: string, text: string): Promise<void> {
  const res = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', text }),
    cache: 'no-store',
  });
  // Slack refusing the reply (e.g. an expired response_url) is only visible in the logs.
  if (!res.ok) console.error('Slack reply refused', res.status, await res.text());
}
