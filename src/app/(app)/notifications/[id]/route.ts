import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { openNotification } from '@/server/notify';
import { getCurrentUser } from '@/server/session';

/** Opening a notification marks it read and goes to what it is about. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/signin', req.url));
  const link = await openNotification(await getDb(), user.id, (await params).id);
  return NextResponse.redirect(new URL(link ?? '/', req.url));
}
