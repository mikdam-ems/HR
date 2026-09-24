'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { devLoginEnabled, signIn, signOut } from '@/auth';
import { LOCALE_COOKIE } from '@/i18n';
import { safePath, str } from '@/lib/forms';

export async function setLocaleAction(fd: FormData) {
  const locale = str(fd, 'locale') === 'ar' ? 'ar' : 'en';
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  redirect(safePath(str(fd, 'back')));
}

export async function signInGoogleAction() {
  await signIn('google', { redirectTo: '/' });
}

export async function signInDevAction(fd: FormData) {
  if (!devLoginEnabled) redirect('/signin');
  await signIn('dev', { email: str(fd, 'email') ?? '', redirectTo: '/' });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/signin' });
}
