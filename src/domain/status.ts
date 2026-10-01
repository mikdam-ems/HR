import { addDays, weekdayOf } from './dates';
import type { ISODate } from './types';

/** How long a status stays up: the rest of today, the rest of this week, or until the person clears it. */
export type StatusDuration = 'today' | 'week' | 'until_cleared';
export const STATUS_DURATIONS: readonly StatusDuration[] = ['today', 'week', 'until_cleared'];

const SATURDAY = 6;

/**
 * The last day a status set today is shown, or null for "until I clear it". The work week here runs Sunday to
 * Thursday, so "this week" lasts through the weekend and is gone when the next week starts on Sunday.
 */
export function statusShowsUntil(duration: StatusDuration, today: ISODate): ISODate | null {
  if (duration === 'today') return today;
  if (duration === 'week') return addDays(today, (SATURDAY - weekdayOf(today) + 7) % 7);
  return null;
}

/** Whether a status is up on `today`: set on or before it, and not past its last day. */
export function isStatusVisible(status: { setOn: ISODate | null; until: ISODate | null }, today: ISODate): boolean {
  if (!status.setOn || status.setOn > today) return false;
  return status.until === null || today <= status.until;
}
