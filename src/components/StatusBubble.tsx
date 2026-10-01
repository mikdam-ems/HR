'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { setStatusAction } from '@/app/(app)/profile/actions';
import { STATUS_DURATIONS, type StatusDuration } from '@/domain/status';

export interface StatusLabels {
  open: string;
  title: string;
  placeholder: string;
  share: string;
  clear: string;
  hint: string;
  duration: string;
  durations: Record<StatusDuration, string>;
  presets: Record<string, string>;
}

type Status = { emoji: string; text: string | null; until: string | null };

/** The duration a status was shared with, read back from its last day. */
function durationOf(status: Status | null, today: string): StatusDuration {
  if (!status) return 'today';
  if (status.until === null) return 'until_cleared';
  return status.until === today ? 'today' : 'week';
}

/** The floating "how's today?" bubble: pick a mood, add a few words, and choose how long colleagues see it. */
export function StatusBubble({ status, today, labels }: { status: Status | null; today: string; labels: StatusLabels }) {
  const [open, setOpen] = useState(false);
  // Nothing is picked until the person chooses; a status only exists once they share one.
  const [emoji, setEmoji] = useState<string | null>(status?.emoji ?? null);
  const [text, setText] = useState(status?.text ?? '');
  const [duration, setDuration] = useState<StatusDuration>(durationOf(status, today));
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const query = useSearchParams().toString();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="status-bubble" ref={box}>
      {open ? (
        <form action={setStatusAction} className="status-panel glass" onSubmit={() => setOpen(false)}>
          <input type="hidden" name="back" value={query ? `${path}?${query}` : path} />
          <input type="hidden" name="emoji" value={emoji ?? ''} />
          <input type="hidden" name="duration" value={duration} />
          <strong>{labels.title}</strong>
          <div className="status-presets" role="radiogroup" aria-label={labels.title}>
            {Object.entries(labels.presets).map(([e, label]) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={emoji === e}
                className="status-preset"
                onClick={() => setEmoji(emoji === e ? null : e)}
              >
                <span aria-hidden="true">{e}</span>
                {label}
              </button>
            ))}
          </div>
          <input
            type="text"
            name="text"
            maxLength={80}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
          />
          <div className="status-duration">
            <span className="muted small" id="status-duration-label">
              {labels.duration}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="status-duration-label">
              {STATUS_DURATIONS.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={duration === d} aria-pressed={duration === d} onClick={() => setDuration(d)}>
                  {labels.durations[d]}
                </button>
              ))}
            </div>
          </div>
          <span className="muted small">{labels.hint}</span>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {status ? (
              <button className="btn btn-small" name="clear" value="1">
                {labels.clear}
              </button>
            ) : null}
            <button className="btn btn-small btn-primary" disabled={!emoji && !text.trim()}>
              {labels.share}
            </button>
          </div>
        </form>
      ) : null}
      <button
        type="button"
        className={`status-fab${status ? ' has-status' : ''}`}
        aria-expanded={open}
        aria-label={labels.open}
        title={status?.text ?? labels.open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="status-fab-emoji" aria-hidden="true">
          {status ? status.emoji : <EmptyStatusIcon />}
        </span>
        <span className="status-fab-text">{status ? (status.text ?? labels.presets[status.emoji] ?? '') : labels.open}</span>
      </button>
    </div>
  );
}

/** An outlined face: "no status yet", so it never reads as a mood someone picked. */
function EmptyStatusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" />
    </svg>
  );
}
