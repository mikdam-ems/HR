import { getDb } from '@/db';
import { employeeForSlackUser, parseCommand, runSlackCommand, slackEmail, verifySlackSignature } from '@/server/slack';

const reply = (text: string) => Response.json({ response_type: 'ephemeral', text });

/**
 * Slack slash commands (/ems in, /ems out, …). Slack posts a signed form here; we answer within Slack's
 * three seconds with a message only the sender sees. Needs SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN.
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
  const slackUserId = form.get('user_id') ?? '';
  const action = parseCommand(form.get('command') ?? '', form.get('text') ?? '');
  const db = await getDb();
  const person = await employeeForSlackUser(db, slackUserId, (id) => slackEmail(id, token));
  if (!person) {
    return reply(
      "I couldn't find you in EMS People & Culture. Your Slack email must match your EMS account — ask People & Culture to add you.",
    );
  }
  return reply(await runSlackCommand(db, person.id, action));
}
