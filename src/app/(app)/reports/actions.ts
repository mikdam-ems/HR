'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { redirectWith, str } from '@/lib/forms';
import { closeMonth, remindUnsubmitted, reopenMonth } from '@/server/reports';
import { requirePermission } from '@/server/session';

const parse = (month: string) => month.split('-').map(Number) as [number, number];

export async function closeMonthAction(fd: FormData) {
  const actor = await requirePermission('months.close');
  const month = str(fd, 'month') ?? '';
  const result = await closeMonth(await getDb(), actor, ...parse(month));
  revalidatePath('/reports');
  redirectWith(`/reports?month=${month}`, result, 'closed');
}

export async function reopenMonthAction(fd: FormData) {
  const actor = await requirePermission('settings.manage');
  const month = str(fd, 'month') ?? '';
  const result = await reopenMonth(await getDb(), actor, ...parse(month));
  revalidatePath('/reports');
  redirectWith(`/reports?month=${month}`, result, 'reopened');
}

export async function remindAction(fd: FormData) {
  const actor = await requirePermission('months.close');
  const month = str(fd, 'month') ?? '';
  const result = await remindUnsubmitted(await getDb(), actor, ...parse(month));
  redirectWith(`/reports?month=${month}`, result, 'reminded');
}
