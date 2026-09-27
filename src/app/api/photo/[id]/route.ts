import { getDb } from '@/db';
import { getPhoto } from '@/server/profile';
import { getCurrentUser } from '@/server/session';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

/** A person's profile photo, for signed-in colleagues. The URL carries ?v=<version>, so it can be cached for good. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const m = DATA_URL.exec((await getPhoto(await getDb(), id)) ?? '');
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(Buffer.from(m[2]!, 'base64')), {
    headers: { 'Content-Type': m[1]!, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
