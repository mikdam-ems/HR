'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clockAction, clockOutAtAction } from '@/app/(app)/clock/actions';
import type { ClockState } from '@/domain';

export interface ClockData {
  state: ClockState;
  /** ISO time the current state began. */
  since: string | null;
  workedMs: number;
  breakMs: number;
  /** Start of today's first session, as "09:05". */
  startedAt: string | null;
  openFrom: { date: string; label: string } | null;
}

export interface ClockLabels {
  title: string;
  notIn: string;
  working: string;
  onBreak: string;
  in: string;
  out: string;
  breakStart: string;
  breakEnd: string;
  worked: string;
  breaks: string;
  started: string;
  forgotTitle: string;
  forgotHint: string;
  leftAt: string;
  close: string;
  pilot: string;
}

/** Milliseconds since the page was rendered — the server totals plus this give a live clock. */
function useElapsed(active: boolean) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now - start;
}

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const hm = (ms: number) => hms(ms).slice(0, -3);

function Action({ kind, label, primary = false, small = false }: { kind: string; label: string; primary?: boolean; small?: boolean }) {
  const back = usePathname();
  return (
    <form action={clockAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="back" value={back} />
      <button className={`btn${primary ? ' btn-primary' : ''}${small ? ' btn-small' : ''}`}>{label}</button>
    </form>
  );
}

/** The big clock card on Home: live timer, state, and the next actions. */
export function ClockCard({ data, labels }: { data: ClockData; labels: ClockLabels }) {
  const elapsed = useElapsed(data.state !== 'out');
  const worked = data.workedMs + (data.state === 'working' ? elapsed : 0);
  const rest = data.breakMs + (data.state === 'break' ? elapsed : 0);
  const back = usePathname();
  const stateLabel = data.state === 'working' ? labels.working : data.state === 'break' ? labels.onBreak : labels.notIn;

  return (
    <section className={`card clock-card clock-${data.state}`} aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">{labels.title}</span>
        <span className="clock-state">
          <span className="clock-dot" aria-hidden="true" />
          {stateLabel}
        </span>
      </div>

      {data.openFrom ? (
        <form action={clockOutAtAction} className="clock-forgot">
          <strong>{labels.forgotTitle.replace('{date}', data.openFrom.label)}</strong>
          <span className="small">{labels.forgotHint}</span>
          <input type="hidden" name="date" value={data.openFrom.date} />
          <input type="hidden" name="back" value={back} />
          <div className="row">
            <label className="small" htmlFor="clock-left">
              {labels.leftAt}
            </label>
            <input id="clock-left" name="time" type="time" required style={{ width: 140 }} />
            <button className="btn btn-small btn-primary">{labels.close}</button>
          </div>
        </form>
      ) : (
        <>
          <div className="clock-time">
            <strong>{hms(worked)}</strong>
            <span className="muted small">
              {labels.worked}
              {data.startedAt ? ` · ${labels.started.replace('{time}', data.startedAt)}` : ''}
              {rest >= 60_000 ? ` · ${labels.breaks} ${hm(rest)}` : ''}
            </span>
          </div>
          <div className="row">
            {data.state === 'out' ? <Action kind="in" label={labels.in} primary /> : null}
            {data.state === 'working' ? <Action kind="break_start" label={labels.breakStart} /> : null}
            {data.state === 'break' ? <Action kind="break_end" label={labels.breakEnd} primary /> : null}
            {data.state !== 'out' ? <Action kind="out" label={labels.out} /> : null}
          </div>
        </>
      )}
      <span className="muted small">{labels.pilot}</span>
    </section>
  );
}

/** The small running clock in the top bar, visible on every page while clocked in. */
export function TopClock({ data, labels }: { data: ClockData; labels: ClockLabels }) {
  const elapsed = useElapsed(data.state !== 'out');
  const back = usePathname();
  if (data.state === 'out' && !data.openFrom) {
    return (
      <form action={clockAction} className="top-clock-form">
        <input type="hidden" name="kind" value="in" />
        <input type="hidden" name="back" value={back} />
        <button className="top-clock top-clock-out" title={labels.notIn}>
          <span className="clock-dot" aria-hidden="true" />
          {labels.in}
        </button>
      </form>
    );
  }
  const worked = data.workedMs + (data.state === 'working' ? elapsed : 0);
  return (
    <a href="/" className={`top-clock clock-${data.state}`} title={data.state === 'break' ? labels.onBreak : labels.working}>
      <span className="clock-dot" aria-hidden="true" />
      <span dir="ltr">{hm(worked)}</span>
      {data.state === 'break' ? <span className="top-clock-tag">☕</span> : null}
    </a>
  );
}
