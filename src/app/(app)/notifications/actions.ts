'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { safePath, str } from '@/lib/forms';
import { markAllRead, savePushSubscription } from '@/server/notify';
import { requireUser } from '@/server/session';

export async function markAllReadAction(fd: FormData) {
  const user = await requireUser();
  await markAllRead(await getDb(), user.id);
  revalidatePath('/', 'layout');
  redirect(safePath(str(fd, 'back')));
}

/** Saves this browser's push subscription so notifications reach it even when the site is closed. */
export async function savePushSubscriptionAction(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<boolean> {
  const user = await requireUser();
  if (typeof sub?.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return false;
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') return false;
  await savePushSubscription(await getDb(), user.id, sub);
  return true;
}
