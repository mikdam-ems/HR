'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { redirectWith, safePath, str } from '@/lib/forms';
import { cancelSwap, decideSwap, requestSwap, respondSwap } from '@/server/swaps';
import { requireUser } from '@/server/session';

// Any employee can ask for or answer a swap, and managers aren't a role, so these can't use requirePermission.
// The server functions check who may do what: the requester, the colleague, or the requester's manager / stand-in.

export async function requestSwapAction(fd: FormData) {
  const user = await requireUser();
  const result = await requestSwap(await getDb(), user, {
    colleagueId: str(fd, 'colleagueId') ?? '',
    date: str(fd, 'date') ?? '',
    note: str(fd, 'note'),
  });
  redirectWith(safePath(str(fd, 'back')), result, 'requested');
}

export async function respondSwapAction(fd: FormData) {
  const user = await requireUser();
  const answer = str(fd, 'answer') === 'accept' ? 'accept' : 'decline';
  const result = await respondSwap(await getDb(), user, str(fd, 'id') ?? '', answer);
  revalidatePath('/', 'layout');
  redirectWith(safePath(str(fd, 'back')), result, answer === 'accept' ? 'saved' : 'declined');
}

export async function decideSwapAction(fd: FormData) {
  const user = await requireUser();
  const outcome = str(fd, 'outcome') === 'approve' ? 'approve' : 'decline';
  const result = await decideSwap(await getDb(), user, str(fd, 'id') ?? '', outcome, str(fd, 'note') ?? null);
  revalidatePath('/', 'layout');
  redirectWith('/approvals', result, outcome === 'approve' ? 'approved' : 'declined');
}

export async function cancelSwapAction(fd: FormData) {
  const user = await requireUser();
  const result = await cancelSwap(await getDb(), user, str(fd, 'id') ?? '');
  redirectWith(safePath(str(fd, 'back')), result, 'withdrawn');
}
