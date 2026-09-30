import { after } from 'next/server';
import { getDb } from '@/db';
import {
  employeeForSlackUser,
  isSlackResponseUrl,
  parseCommand,
  parseLocation,
  postSlackReply,
  runSlackCommand,
  slackEmail,
  verifySlackSignature,
} from '@/server/slack';

const NOT_FOUND =
  "I couldn't find you in EMS People & Culture. Your Slack email must match your EMS account — ask People & Culture to add you.";
const FAILED = 'Something went wrong on our side, so nothing was recorded. Please try again in a minute.';

/**
 * Slack slash commands (/ems in, /kadr out, …). Slack posts a signed form here and gives up after three seconds.
 * A cold start (connecting to the database and checking migrations) plus the first email lookup can take longer
 * than that, so we acknowledge at once and send the reply to Slack's response_url when it's ready.
 * Only the person who typed the command sees it. Needs SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN.
 */
export async function POST(request: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!secret || !token) return new Response('Slack is not set up on this site.', { status: 503 });

  const body = await request.text();
  const ok = verifySlackSignature(
    secret,
    request.headers.get('x-slack-request-timestamp'),
    request.headers.get('x-slack-signature'),
    body,
  );
  if (!ok) return new Response('Invalid signature', { status: 401 });

  const form = new URLSearchParams(body);
  const responseUrl = form.get('response_url');
  if (!isSlackResponseUrl(responseUrl)) return new Response('Missing response_url', { status: 400 });

  after(async () => {
    const text = await answer(form, token).catch((e: unknown) => {
      console.error('Slack command failed', e);
      return FAILED;
    });
    await postSlackReply(responseUrl, text).catch((e: unknown) => console.error('Slack reply not delivered', e));
  });
  // An empty 200 tells Slack we got it; the reply follows through response_url.
  return new Response(null, { status: 200 });
}

async function answer(form: URLSearchParams, token: string): Promise<string> {
  const action = parseCommand(form.get('command') ?? '', form.get('text') ?? '');
  const db = await getDb();
  const person = await employeeForSlackUser(db, form.get('user_id') ?? '', (id) => slackEmail(id, token));
  if (!person) return NOT_FOUND;
  return runSlackCommand(db, person.id, action, new Date(), parseLocation(form.get('text') ?? ''));
}
