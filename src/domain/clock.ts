/**
 * Clocking in and out: what state someone is in, and how long they worked and rested each day.
 * A session belongs to the date it started on (a night shift that ends after midnight counts for the day it began).
 */

export type ClockKind = 'in' | 'out' | 'break_start' | 'break_end';
export type ClockState = 'out' | 'working' | 'break';

export interface ClockEvent {
  at: Date;
  kind: ClockKind;
}

export interface ClockDay {
  date: string;
  firstIn: Date;
  lastOut: Date | null;
  workedMs: number;
  breakMs: number;
  /** Still clocked in (working or on a break). */
  open: boolean;
}

/** Which actions make sense from each state. Clocking out from a break ends the break too. */
export const CLOCK_TRANSITIONS: Record<ClockState, ClockKind[]> = {
  out: ['in'],
  working: ['break_start', 'out'],
  break: ['break_end', 'out'],
};

const AFTER: Record<ClockKind, ClockState> = { in: 'working', break_start: 'break', break_end: 'working', out: 'out' };

export function stateAfter(events: readonly ClockEvent[]): { state: ClockState; since: Date | null } {
  const last = events[events.length - 1];
  return last ? { state: AFTER[last.kind], since: last.at } : { state: 'out', since: null };
}

export function canClock(state: ClockState, kind: ClockKind): boolean {
  return CLOCK_TRANSITIONS[state].includes(kind);
}

/**
 * Sums worked and break time per day from events in time order. An open session counts up to `now`.
 * Events that don't fit (e.g. a second "in" while working) are ignored rather than trusted.
 */
export function summarizeClock(
  events: readonly ClockEvent[],
  now: Date,
  dateOf: (d: Date) => string,
): Map<string, ClockDay> {
  const days = new Map<string, ClockDay>();
  let state: ClockState = 'out';
  let day: ClockDay | null = null;
  let mark = 0; // start of the current work or break stretch

  const close = (until: number) => {
    if (!day) return;
    if (state === 'working') day.workedMs += Math.max(0, until - mark);
    if (state === 'break') day.breakMs += Math.max(0, until - mark);
  };

  for (const e of events) {
    if (!canClock(state, e.kind)) continue;
    const t = e.at.getTime();
    if (e.kind === 'in') {
      const date = dateOf(e.at);
      day = days.get(date) ?? { date, firstIn: e.at, lastOut: null, workedMs: 0, breakMs: 0, open: false };
      days.set(date, day);
    } else {
      close(t);
    }
    if (e.kind === 'out' && day) day.lastOut = e.at;
    state = AFTER[e.kind];
    mark = t;
  }
  if (state !== 'out' && day) {
    close(now.getTime());
    day.open = true;
  }
  for (const d of days.values()) if (d.open) d.lastOut = null;
  return days;
}

export const msToMinutes = (ms: number) => Math.floor(ms / 60000);
