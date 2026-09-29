'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { devLoginEnabled, signIn, signOut } from '@/auth';
import { BRAND_COOKIE, brandPreview } from '@/brand';
import { LOCALE_COOKIE } from '@/i18n';
import { safePath, str } from '@/lib/forms';

export async function setLocaleAction(fd: FormData) {
  const locale = str(fd, 'locale') === 'ar' ? 'ar' : 'en';
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  redirect(safePath(str(fd, 'back')));
}

/** A display preference like the language, so it works before sign-in; it does nothing unless brand preview is on. */
export async function setBrandAction(fd: FormData) {
  if (brandPreview) {
    const brand = str(fd, 'brand') === 'kadr' ? 'kadr' : 'ems';
    (await cookies()).set(BRAND_COOKIE, brand, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
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
