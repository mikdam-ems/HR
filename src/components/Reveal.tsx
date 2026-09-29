'use client';

import { useRef } from 'react';

/**
 * A button that opens a form in place ("Add shift" → the shift card), instead of every form being open from
 * the start. The card has a ✕ to put it away; submitting reloads the page with it closed again.
 */
export function Reveal({
  label,
  cancelLabel,
  children,
  defaultOpen = false,
  primary = false,
  edit = false,
  className = '',
}: {
  label: string;
  cancelLabel: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  primary?: boolean;
  /** Changes something that exists (a pencil) rather than adding something new (a plus). */
  edit?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      className={`reveal ${className}`}
      open={defaultOpen}
      onToggle={() => {
        if (!ref.current?.open) return;
        ref.current.querySelector<HTMLElement>('.reveal-body input:not([type=hidden]), .reveal-body select, .reveal-body textarea')?.focus();
      }}
    >
      <summary className={`btn ${primary ? 'btn-primary' : ''}`}>
        <span aria-hidden="true">{edit ? '✎' : '+'}</span> {label}
      </summary>
      <div className="reveal-body">
        <button
          type="button"
          className="reveal-close"
          aria-label={cancelLabel}
          title={cancelLabel}
          onClick={() => {
            if (ref.current) ref.current.open = false;
          }}
        >
          ✕
        </button>
        {children}
      </div>
    </details>
  );
}
