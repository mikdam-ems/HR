'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { redirectWith, safePath, str } from '@/lib/forms';
import { cancelDelegation, createDelegation } from '@/server/delegation';
import { requireUser } from '@/server/session';

// Managers aren't a role, so these can't use requirePermission: the server functions check that the actor is the
// manager themselves or has people.manage (HR, admin), and refuse everyone else.

/** A manager (or HR for them) hands their approvals to a colleague for some dates. */
export async function createDelegationAction(fd: FormData) {
  const user = await requireUser();
  const result = await createDelegation(await getDb(), user, {
    managerId: str(fd, 'managerId') ?? '',
    deputyId: str(fd, 'deputyId') ?? '',
    fromDate: str(fd, 'fromDate') ?? '',
    toDate: str(fd, 'toDate') ?? '',
  });
  revalidatePath('/', 'layout');
  redirectWith(safePath(str(fd, 'back')), result, 'created');
}

export async function cancelDelegationAction(fd: FormData) {
  const user = await requireUser();
  const result = await cancelDelegation(await getDb(), user, str(fd, 'id') ?? '');
  revalidatePath('/', 'layout');
  redirectWith(safePath(str(fd, 'back')), result, 'removed');
}
