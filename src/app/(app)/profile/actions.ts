'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import type { StatusDuration } from '@/domain';
import { redirectWith, safePath, str } from '@/lib/forms';
import { setPhoto, setStatus, updateOwnProfile } from '@/server/profile';
import { requireUser } from '@/server/session';

/** People edit their own photo and bio. */
export async function saveProfileAction(fd: FormData) {
  const user = await requireUser();
  const db = await getDb();
  const result = await updateOwnProfile(db, user.id, { bio: str(fd, 'bio'), birthDate: str(fd, 'birthDate') });
  if (!result.ok) redirectWith('/profile', result);
  const photo = str(fd, 'photo');
  if (photo || str(fd, 'removePhoto')) {
    const saved = await setPhoto(db, user.id, str(fd, 'removePhoto') ? null : photo);
    if (!saved.ok) redirectWith('/profile', saved);
  }
  revalidatePath('/', 'layout');
  redirectWith('/profile', result);
}

/** The floating status bubble: set today's status, or clear it. Returns to the page it was used on. */
export async function setStatusAction(fd: FormData) {
  const user = await requireUser();
  const text = str(fd, 'text');
  // Words without a mood still count as a status; they get a speech bubble.
  const emoji = str(fd, 'emoji') ?? (text ? '💬' : null);
  const clear = str(fd, 'clear') || !emoji;
  // An unknown duration is refused by setStatus's validation, so the cast only satisfies the type.
  const duration = (str(fd, 'duration') ?? 'today') as StatusDuration;
  await setStatus(await getDb(), user.id, clear ? null : { emoji: emoji!, text, duration });
  revalidatePath('/', 'layout');
  redirect(safePath(str(fd, 'back')));
}
