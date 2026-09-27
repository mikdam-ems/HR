'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { setStatusAction } from '@/app/(app)/profile/actions';

export interface StatusLabels {
  open: string;
  title: string;
  placeholder: string;
  share: string;
  clear: string;
  hint: string;
  presets: Record<string, string>;
}

/** The floating "how's today?" bubble: pick a mood, add a few words, share it with colleagues for the day. */
export function StatusBubble({ status, labels }: { status: { emoji: string; text: string | null } | null; labels: StatusLabels }) {
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState(status?.emoji ?? '🙂');
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
          <input type="hidden" name="emoji" value={emoji} />
          <strong>{labels.title}</strong>
          <div className="status-presets" role="radiogroup" aria-label={labels.title}>
            {Object.entries(labels.presets).map(([e, label]) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={emoji === e}
                className="status-preset"
                onClick={() => setEmoji(e)}
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
            defaultValue={status?.text ?? ''}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
          />
          <span className="muted small">{labels.hint}</span>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {status ? (
              <button className="btn btn-small" name="clear" value="1">
                {labels.clear}
              </button>
            ) : null}
            <button className="btn btn-small btn-primary">{labels.share}</button>
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
          {status?.emoji ?? '🙂'}
        </span>
        <span className="status-fab-text">{status ? (status.text ?? labels.presets[status.emoji] ?? '') : labels.open}</span>
      </button>
    </div>
  );
}
