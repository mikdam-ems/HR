import { getDb } from '@/db';
import { getAttachment } from '@/server/leave';
import { getCurrentUser } from '@/server/session';

/** A leave request's supporting document, for the person, their approver, and HR/admin. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const file = await getAttachment(await getDb(), user, id);
  if (!file.ok) return new Response(file.error === 'forbidden' ? 'Forbidden' : 'Not found', { status: file.error === 'forbidden' ? 403 : 404 });
  const name = encodeURIComponent(file.value.fileName);
  return new Response(new Uint8Array(file.value.bytes), {
    headers: {
      'Content-Type': file.value.contentType,
      // Shown in the browser (PDF/image), never run as a page.
      'Content-Disposition': `inline; filename*=UTF-8''${name}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
