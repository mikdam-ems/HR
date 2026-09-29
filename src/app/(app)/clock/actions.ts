'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { workLocationEnum, type WorkLocation } from '@/db/schema';
import type { ClockKind } from '@/domain';
import { redirectWith, safePath, str } from '@/lib/forms';
import { clock, clockOutAt } from '@/server/clock';
import { requireUser } from '@/server/session';

const KINDS: ClockKind[] = ['in', 'out', 'break_start', 'break_end'];

/** Clock in / out / break from the Home card or the top bar. Clocking in may say where (else the last choice is kept). */
export async function clockAction(fd: FormData) {
  const user = await requireUser();
  const kind = str(fd, 'kind') as ClockKind;
  const back = safePath(str(fd, 'back'));
  if (!KINDS.includes(kind)) redirect(back);
  const picked = str(fd, 'location') as WorkLocation;
  const location = workLocationEnum.enumValues.includes(picked) ? picked : null;
  const result = await clock(await getDb(), user.id, kind, new Date(), 'web', location);
  revalidatePath('/', 'layout');
  if (!result.ok) redirectWith(back, result);
  redirect(back);
}

/** Closes a session left open from an earlier day, at the time the person says they left. */
export async function clockOutAtAction(fd: FormData) {
  const user = await requireUser();
  const result = await clockOutAt(await getDb(), user.id, str(fd, 'date') ?? '', str(fd, 'time') ?? '');
  revalidatePath('/', 'layout');
  redirectWith(safePath(str(fd, 'back')), result);
}
