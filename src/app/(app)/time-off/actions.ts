'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { bool, redirectWith, str } from '@/lib/forms';
import { addAdjustment, cancelRequest, createRequest, decideRequest } from '@/server/leave';
import { requirePermission, requireUser } from '@/server/session';

export async function requestLeaveAction(fd: FormData) {
  const user = await requireUser();
  const result = await createRequest(await getDb(), user, {
    type: (str(fd, 'type') ?? 'annual') as never,
    fromDate: str(fd, 'from') ?? '',
    toDate: str(fd, 'to') ?? str(fd, 'from') ?? '',
    halfDay: bool(fd, 'halfDay'),
    note: str(fd, 'note'),
  });
  revalidatePath('/time-off');
  revalidatePath('/approvals');
  redirectWith('/time-off', result, 'requested');
}

export async function cancelLeaveAction(fd: FormData) {
  const user = await requireUser();
  const result = await cancelRequest(await getDb(), user, str(fd, 'id') ?? '');
  revalidatePath('/time-off');
  redirectWith('/time-off', result, 'cancelled');
}

export async function decideLeaveAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, 'id') ?? '';
  const outcome = str(fd, 'outcome') === 'approve' ? 'approve' : 'decline';
  const result = await decideRequest(await getDb(), user, id, outcome, str(fd, 'note'));
  revalidatePath('/approvals');
  if (!result.ok) redirectWith(`/approvals?l=${id}`, result);
  redirectWith('/approvals', result, outcome === 'approve' ? 'approved' : 'declined');
}

export async function addAdjustmentAction(fd: FormData) {
  const actor = await requirePermission('people.manage');
  const employeeId = str(fd, 'employeeId') ?? '';
  const result = await addAdjustment(await getDb(), actor.id, {
    employeeId,
    year: Number(str(fd, 'year')),
    type: (str(fd, 'type') ?? 'annual') as never,
    days: Number(str(fd, 'days')),
    reason: str(fd, 'reason') ?? '',
  });
  redirectWith(`/people/${employeeId}`, result);
}
