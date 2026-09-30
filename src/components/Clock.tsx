'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clockAction, clockOutAtAction } from '@/app/(app)/clock/actions';
import type { WorkLocation } from '@/db/schema';
import type { ClockState } from '@/domain';
import { fmt } from '@/i18n/fmt';

const LOCATIONS: WorkLocation[] = ['office', 'client_site', 'remote'];

export interface ClockData {
  state: ClockState;
  /** ISO time the current state began. */
  since: string | null;
  workedMs: number;
  breakMs: number;
  /** Start of today's first session, as "09:05". */
  startedAt: string | null;
  openFrom: { date: string; label: string } | null;
  /** A full day today (the scheduled minutes, e.g. 8h30); 0 on a day off, where any work is overtime. */
  targetMs: number;
  /** Where the current session is worked from. */
  location: WorkLocation | null;
  /** Their last choice, picked in advance for the next clock-in. */
  usualLocation: WorkLocation | null;
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
  fullDay: string;
  overtime: string;
  left: string;
  of: string;
  log: string;
  where: string;
  locations: Record<WorkLocation, string>;
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

/** Where today stands against a full day. */
function progress(workedMs: number, targetMs: number) {
  const over = workedMs - targetMs;
  return {
    pct: targetMs ? Math.min(100, (workedMs / targetMs) * 100) : 100,
    full: targetMs > 0 && workedMs >= targetMs,
    overMs: Math.max(0, over),
    leftMs: targetMs > workedMs ? targetMs - workedMs : 0,
  };
}

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
        <span className="row" style={{ gap: 8 }}>
          {data.location ? <span className="where-chip">{labels.locations[data.location]}</span> : null}
          <span className="clock-state">
            <span className="clock-dot" aria-hidden="true" />
            {stateLabel}
          </span>
        </span>
      </div>

      {data.openFrom ? (
        <form action={clockOutAtAction} className="clock-forgot">
          <strong>{fmt(labels.forgotTitle, { date: data.openFrom.label })}</strong>
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
              {data.startedAt ? ` · ${fmt(labels.started, { time: data.startedAt })}` : ''}
              {rest >= 60_000 ? ` · ${labels.breaks} ${hm(rest)}` : ''}
            </span>
          </div>
          {(() => {
            const p = progress(worked, data.targetMs);
            return (
              <div className="clock-progress">
                <div
                  className={`progress${p.overMs ? ' progress-over' : ''}`}
                  role="progressbar"
                  aria-label={labels.fullDay}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(p.pct)}
                  aria-valuetext={data.targetMs ? `${hm(worked)} / ${hm(data.targetMs)}` : hm(worked)}
                >
                  <span style={{ inlineSize: `${p.pct}%` }} />
                </div>
                <span className="small clock-verdict">
                  {p.overMs
                    ? `${p.full ? `✓ ${labels.fullDay} · ` : ''}${labels.overtime} +${hm(p.overMs)}`
                    : p.full
                      ? `✓ ${labels.fullDay}`
                      : data.targetMs
                        ? fmt(labels.left, { time: hm(p.leftMs), target: hm(data.targetMs) })
                        : ''}
                </span>
              </div>
            );
          })()}
          {data.state === 'out' ? (
            <form action={clockAction} className="clock-in-form">
              <input type="hidden" name="kind" value="in" />
              <input type="hidden" name="back" value={back} />
              <fieldset className="where-picker">
                <legend className="small">{labels.where}</legend>
                {LOCATIONS.map((w) => (
                  <label key={w}>
                    <input type="radio" name="location" value={w} defaultChecked={data.usualLocation === w} />
                    <span>{labels.locations[w]}</span>
                  </label>
                ))}
              </fieldset>
              <button className="btn btn-primary">{labels.in}</button>
            </form>
          ) : (
            <div className="row">
              {data.state === 'working' ? <Action kind="break_start" label={labels.breakStart} /> : null}
              {data.state === 'break' ? <Action kind="break_end" label={labels.breakEnd} primary /> : null}
              <Action kind="out" label={labels.out} />
            </div>
          )}
        </>
      )}
      <span className="row muted small" style={{ justifyContent: 'space-between' }}>
        <span>{labels.pilot}</span>
        <Link href="/attendance">{labels.log}</Link>
      </span>
    </section>
  );
}

/** The top-bar total: today's worked hours against a full day, always visible, with overtime once it's passed. */
export function TopClock({ data, labels }: { data: ClockData; labels: ClockLabels }) {
  const elapsed = useElapsed(data.state !== 'out');
  const back = usePathname();
  const worked = data.workedMs + (data.state === 'working' ? elapsed : 0);
  const clockIn = (
    <form action={clockAction} className="top-clock-form">
      <input type="hidden" name="kind" value="in" />
      <input type="hidden" name="back" value={back} />
      <button className="top-clock top-clock-out" title={labels.notIn}>
        <span className="clock-dot" aria-hidden="true" />
        {labels.in}
      </button>
    </form>
  );
  if (data.state === 'out' && !data.openFrom && worked < 60_000) return clockIn;
  const p = progress(worked, data.targetMs);
  const title = [
    data.state === 'break' ? labels.onBreak : data.state === 'working' ? labels.working : labels.notIn,
    p.full ? labels.fullDay : null,
    p.overMs ? `${labels.overtime} +${hm(p.overMs)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const total = (
    <Link href={data.openFrom ? '/' : '/attendance'} className={`top-clock clock-${data.state}${p.full ? ' is-full' : ''}${p.overMs ? ' is-over' : ''}`} title={title}>
      <span className="clock-dot" aria-hidden="true" />
      <span dir="ltr" className="top-clock-time">
        {hm(worked)}
        {!p.full && data.targetMs ? <span className="top-clock-of"> / {hm(data.targetMs)}</span> : null}
        {p.full && !p.overMs ? <span className="top-clock-tag"> ✓</span> : null}
      </span>
      {p.overMs ? (
        <span className="top-clock-over" dir="ltr">
          +{hm(p.overMs)}
        </span>
      ) : null}
      {data.state === 'break' ? <span className="top-clock-tag">☕</span> : null}
    </Link>
  );
  // Clocked out after working today (lunch, a client visit): keep the total and offer the next session.
  if (data.state === 'out' && !data.openFrom) {
    return (
      <span className="top-clock-group">
        {total}
        {clockIn}
      </span>
    );
  }
  return total;
}
