'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { redirectWith, str } from '@/lib/forms';
import { requireUser } from '@/server/session';
import { approveMonth, cancelDayChange, decideDayChange, resetDay, returnMonth, saveDay, submitMonth, type SaveOutcome } from '@/server/timesheets';
import type { Result } from '@/server/validation';

const monthOf = (date: string) => date.slice(0, 7);

/** Straight onto the timesheet, sent to the manager, or nothing to send. */
const outcomeCode = (r: Result<SaveOutcome>) => (!r.ok ? 'saved' : r.value.applied ? 'applied' : r.value.requestId ? 'requested' : 'withdrawn');

export async function saveDayAction(fd: FormData) {
  const user = await requireUser();
  const date = str(fd, 'date') ?? '';
  const leaveType = str(fd, 'leaveType');
  const result = await saveDay(await getDb(), user, user.id, {
    date,
    startTime: str(fd, 'startTime'),
    endTime: str(fd, 'endTime'),
    leaveType: leaveType as never,
    leavePortion: str(fd, 'leavePortion') === '0.5' ? 0.5 : 1,
    note: str(fd, 'note'),
  });
  revalidatePath('/timesheet');
  revalidatePath('/approvals');
  redirectWith(`/timesheet/${user.id}?month=${monthOf(date)}&day=${date}`, result, outcomeCode(result));
}

export async function resetDayAction(fd: FormData) {
  const user = await requireUser();
  const date = str(fd, 'date') ?? '';
  const result = await resetDay(await getDb(), user, user.id, date);
  revalidatePath('/approvals');
  redirectWith(`/timesheet/${user.id}?month=${monthOf(date)}&day=${date}`, result, outcomeCode(result));
}

export async function cancelDayChangeAction(fd: FormData) {
  const user = await requireUser();
  const date = str(fd, 'date') ?? '';
  const result = await cancelDayChange(await getDb(), user, str(fd, 'id') ?? '');
  revalidatePath('/approvals');
  redirectWith(`/timesheet/${user.id}?month=${monthOf(date)}&day=${date}`, result, 'withdrawn');
}

/** The manager approves or declines one day change. */
export async function decideDayChangeAction(fd: FormData) {
  const user = await requireUser();
  const approve = str(fd, 'outcome') === 'approve';
  const result = await decideDayChange(await getDb(), user, str(fd, 'id') ?? '', approve ? 'approve' : 'decline', str(fd, 'note'));
  revalidatePath('/approvals');
  revalidatePath('/timesheet');
  redirectWith('/approvals', result, approve ? 'approved' : 'declined');
}

export async function submitMonthAction(fd: FormData) {
  const user = await requireUser();
  const month = str(fd, 'month') ?? '';
  const [y, m] = month.split('-').map(Number);
  const result = await submitMonth(await getDb(), user, user.id, y ?? 0, m ?? 0);
  revalidatePath('/approvals');
  redirectWith(`/timesheet/${user.id}?month=${month}`, result, 'submitted');
}

export async function decideAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, 'timesheetId') ?? '';
  const note = str(fd, 'note');
  const db = await getDb();
  const result = str(fd, 'outcome') === 'approve' ? await approveMonth(db, user, id, note) : await returnMonth(db, user, id, note);
  revalidatePath('/approvals');
  if (!result.ok) redirectWith(`/approvals?t=${id}`, result);
  redirectWith('/approvals', result, str(fd, 'outcome') === 'approve' ? 'approved' : 'returned');
}
