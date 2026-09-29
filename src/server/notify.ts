import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import type { DB } from '@/db';
import { employees, notifications, pushSubscriptions, type Employee } from '@/db/schema';
import { en } from '@/i18n/en';
import { notificationText, type NotificationKind } from '@/lib/notificationText';

/**
 * Tells people about things that need them (a request to approve) or concern them (a decision on theirs).
 * Every notification is saved for the bell; Slack DMs and browser pushes go out after the response,
 * so a slow or unconfigured Slack never slows down an approval.
 */
export async function notify(
  db: DB,
  recipientIds: readonly string[],
  kind: NotificationKind,
  data: Record<string, string | number | null>,
  link: string,
): Promise<void> {
  const ids = [...new Set(recipientIds)];
  if (!ids.length) return;
  const rows = await db
    .insert(notifications)
    .values(ids.map((employeeId) => ({ employeeId, kind, data, link })))
    .returning();
  runAfterResponse(() => deliver(db, rows.map((r) => r.employeeId), kind, data, link));
}

/** Who decides this person's requests: their manager, or the admins when they have none (never themselves). */
export async function approversOf(db: DB, employee: Pick<Employee, 'id' | 'managerId'>): Promise<string[]> {
  if (employee.managerId) return [employee.managerId];
  const admins = await db.select().from(employees).where(eq(employees.active, true));
  return admins.filter((a) => a.roles.includes('admin') && a.id !== employee.id).map((a) => a.id);
}

export async function listNotifications(db: DB, employeeId: string, limit = 15) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.employeeId, employeeId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnread(db: DB, employeeId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.employeeId, employeeId), isNull(notifications.readAt)));
  return rows.length;
}

export async function markAllRead(db: DB, employeeId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.employeeId, employeeId), isNull(notifications.readAt)));
}

/** Marks one of this person's notifications read and returns where it points; null if it isn't theirs. */
export async function openNotification(db: DB, employeeId: string, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.employeeId, employeeId)))
    .returning();
  return row && row.link.startsWith('/') && !row.link.startsWith('//') ? row.link : null;
}

/** Saves (or refreshes) a browser's push subscription for this person. */
export async function savePushSubscription(
  db: DB,
  employeeId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  const values = { employeeId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
  await db.insert(pushSubscriptions).values(values).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
}

// ---------- delivery ----------

/** Runs work after the response when inside a Next.js request (keeps approvals fast); otherwise right away. */
function runAfterResponse(work: () => Promise<void>) {
  const safe = () => work().catch((e) => console.error('notification delivery failed', e));
  import('next/server')
    .then(({ after }) => after(safe))
    .catch(() => void safe());
}

export function siteUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}

async function deliver(db: DB, ids: string[], kind: NotificationKind, data: Record<string, string | number | null>, link: string) {
  const text = notificationText(en, 'en', kind, data);
  const url = `${siteUrl()}${link}`;
  await Promise.all([slackDeliver(db, ids, text, url), pushDeliver(db, ids, text, url)]);
}

async function slackDeliver(db: DB, ids: string[], text: { title: string; body: string }, url: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  const people = await db.select().from(employees).where(inArray(employees.id, ids));
  for (const p of people) {
    const slackId = p.slackUserId ?? (await slackIdByEmail(token, p.email));
    if (!slackId) continue;
    if (!p.slackUserId) await db.update(employees).set({ slackUserId: slackId }).where(eq(employees.id, p.id));
    await slackPost(token, slackId, `*${text.title}*\n${text.body}\n<${url}|Open in People & Culture>`);
  }
}

export async function slackPost(token: string, channel: string, text: string): Promise<boolean> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) console.error('slack chat.postMessage failed:', json.error);
  return json.ok;
}

async function slackIdByEmail(token: string, email: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { ok: boolean; user?: { id: string } };
  return json.ok ? (json.user?.id ?? null) : null;
}

let vapidReady = false;
function vapid(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? `${siteUrl()}`, pub, priv);
    vapidReady = true;
  }
  return true;
}

async function pushDeliver(db: DB, ids: string[], text: { title: string; body: string }, url: string) {
  if (!vapid()) return;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.employeeId, ids));
  const payload = JSON.stringify({ title: text.title, body: text.body, url });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        // The browser unsubscribed or the subscription expired: forget it.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      }
    }),
  );
}
