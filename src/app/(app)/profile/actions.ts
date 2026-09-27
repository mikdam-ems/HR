'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { redirectWith, safePath, str } from '@/lib/forms';
import { setPhoto, setStatus, updateOwnProfile } from '@/server/profile';
import { requireUser } from '@/server/session';

/** People edit their own name, title, bio and photo. */
export async function saveProfileAction(fd: FormData) {
  const user = await requireUser();
  const db = await getDb();
  const result = await updateOwnProfile(db, user.id, {
    nameEn: str(fd, 'nameEn') ?? '',
    nameAr: str(fd, 'nameAr'),
    jobTitle: str(fd, 'jobTitle'),
    bio: str(fd, 'bio'),
  });
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
  const emoji = str(fd, 'emoji');
  const clear = str(fd, 'clear') || !emoji;
  await setStatus(await getDb(), user.id, clear ? null : { emoji: emoji!, text: str(fd, 'text') });
  revalidatePath('/', 'layout');
  redirect(safePath(str(fd, 'back')));
}
