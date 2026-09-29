'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LeaveCalendarMarks } from '@/domain';

export interface RangeLabels {
  choose: string;
  from: string;
  to: string;
  cancel: string;
  apply: string;
  prev: string;
  next: string;
  today: string;
  workingDays: string;
  pickEnd: string;
  overlaps: string;
  legendApproved: string;
  legendPending: string;
  legendHoliday: string;
  legendWeekend: string;
  booked: string;
}

// ---------- dates (ISO strings, UTC so no time zone shifts) ----------
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(toMs(d) + n * 86_400_000);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const addMonths = (d: string, n: number) => {
  const dt = new Date(toMs(monthStart(d)));
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return iso(dt.getTime());
};
const each = (a: string, b: string) => {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "{n} day|{n} days" (English) or the six Arabic forms, picked for n. */
function plural(template: string, n: number): string {
  const parts = template.split('|');
  const forms = parts.length === 6 ? ['zero', 'one', 'two', 'few', 'many', 'other'] : ['one', 'other'];
  const pick = parts[forms.indexOf(new Intl.PluralRules(parts.length === 6 ? 'ar' : 'en').select(n))] ?? parts[parts.length - 1]!;
  return pick.replace('{n}', String(n));
}

/** Six weeks starting on the Sunday on or before the 1st, like the EMS work week. */
function monthGrid(first: string): string[] {
  const start = addDays(first, -new Date(toMs(first)).getUTCDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * One calendar for picking the first and last day of time off. Days already requested are coloured and can't be
 * picked again; weekends and client holidays are shown so people see which days leave won't use.
 */
export function DateRangePicker({
  from: initialFrom,
  to: initialTo,
  today,
  marks,
  locale,
  labels,
}: {
  from: string;
  to: string;
  today: string;
  marks: LeaveCalendarMarks;
  locale: 'en' | 'ar';
  labels: RangeLabels;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo || initialFrom);
  const [open, setOpen] = useState(false);
  // Draft selection inside the popover; only Apply commits it.
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(monthStart(from || today));
  const [focusDate, setFocusDate] = useState(from || today);
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();

  const tag = locale === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB';
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { ...o, timeZone: 'UTC' }).format(new Date(toMs(d)));
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(tag, { weekday: locale === 'ar' ? 'narrow' : 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + i)))),
    [tag, locale],
  );

  const lo = start && end ? (start <= end ? start : end) : start;
  const hi = start && end ? (start <= end ? end : start) : start;
  // While choosing the end, the band follows the pointer.
  const previewEnd = start && !end && hover ? hover : null;
  const bandLo = previewEnd ? (previewEnd < start ? previewEnd : start) : lo;
  const bandHi = previewEnd ? (previewEnd < start ? start : previewEnd) : hi;
  const clash = lo && hi ? each(lo, hi).some((d) => marks.booked[d]) : false;
  const working = lo && hi ? each(lo, hi).filter((d) => !marks.off[d]).length : 0;

  function show() {
    setStart(from);
    setEnd(to);
    setHover(null);
    setView(monthStart(from || today));
    setFocusDate(from || today);
    setOpen(true);
  }
  function cancel() {
    setOpen(false);
  }
  function apply() {
    if (!lo || clash) return;
    setFrom(lo);
    setTo(hi || lo);
    setOpen(false);
  }
  function pick(d: string) {
    if (marks.booked[d]) return;
    if (!start || end) {
      setStart(d);
      setEnd('');
    } else {
      setEnd(d);
    }
    setFocusDate(d);
  }

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Keep keyboard focus on the focused day as it moves.
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [open, focusDate, view]);

  function onGridKey(e: React.KeyboardEvent) {
    const rtl = locale === 'ar';
    const step: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const next = addDays(focusDate, step[e.key]!);
    if (next < view) setView(addMonths(view, -1));
    else if (next >= addMonths(view, 2)) setView(addMonths(view, 1));
    setFocusDate(next);
  }

  const summary = from
    ? from === to
      ? fmt(from, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : labels.choose;

  return (
    <div className="drp" ref={wrap}>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <button type="button" className="drp-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => (open ? cancel() : show())}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className={from ? undefined : 'muted'}>{summary}</span>
      </button>

      {open ? (
        <div className="drp-pop card" id={id} role="dialog" aria-label={labels.choose}>
          <div className="drp-months" ref={grid} onKeyDown={onGridKey}>
            {[0, 1].map((m) => {
              const first = addMonths(view, m);
              return (
                <div key={first} className={`drp-month${m ? ' drp-second' : ''}`}>
                  <div className="drp-month-head">
                    {m === 0 ? (
                      <button type="button" className="drp-nav" onClick={() => setView(addMonths(view, -1))} aria-label={labels.prev}>
                        <span className="flip" aria-hidden="true">‹</span>
                      </button>
                    ) : (
                      <span className="drp-nav-space drp-hide-narrow" />
                    )}
                    <strong>{fmt(first, { month: 'long', year: 'numeric' })}</strong>
                    <button
                      type="button"
                      className={`drp-nav${m === 0 ? ' drp-show-narrow' : ''}`}
                      onClick={() => setView(addMonths(view, 1))}
                      aria-label={labels.next}
                    >
                      <span className="flip" aria-hidden="true">›</span>
                    </button>
                  </div>
                  <div className="drp-grid" role="grid">
                    {weekdays.map((w) => (
                      <span key={w} className="drp-wd" role="columnheader">
                        {w}
                      </span>
                    ))}
                    {monthGrid(first).map((d) => {
                      const inMonth = d.slice(0, 7) === first.slice(0, 7);
                      if (!inMonth) return <span key={d} className="drp-cell drp-outside" aria-hidden="true" />;
                      const booked = marks.booked[d];
                      const off = marks.off[d];
                      const inBand = bandLo && bandHi && d >= bandLo && d <= bandHi;
                      const edge = d === lo || d === hi || d === previewEnd || (d === start && !end);
                      const holidayName = off?.kind === 'holiday' ? (locale === 'ar' && off.nameAr) || off.name : undefined;
                      const title = [
                        booked ? `${labels.booked} (${booked.status === 'approved' ? labels.legendApproved : labels.legendPending})` : '',
                        holidayName ?? '',
                        d === today ? labels.today : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      const cls = [
                        'drp-cell',
                        inBand ? 'drp-band' : '',
                        inBand && d === bandLo ? 'drp-band-start' : '',
                        inBand && d === bandHi ? 'drp-band-end' : '',
                        edge && inBand ? 'drp-edge' : '',
                        booked ? `drp-booked drp-${booked.status}` : '',
                        off ? `drp-off drp-${off.kind}` : '',
                        d === today ? 'drp-today' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <span key={d} className={cls} role="gridcell" aria-selected={Boolean(inBand)}>
                          <button
                            type="button"
                            data-date={d}
                            tabIndex={d === focusDate ? 0 : -1}
                            disabled={Boolean(booked)}
                            title={title || undefined}
                            aria-label={`${fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${title ? ` · ${title}` : ''}`}
                            onClick={() => pick(d)}
                            onMouseEnter={() => setHover(d)}
                            onFocus={() => setHover(d)}
                          >
                            {Number(d.slice(8))}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <ul className="drp-legend">
            <li>
              <span className="drp-key drp-key-approved" aria-hidden="true" />
              {labels.legendApproved}
            </li>
            <li>
              <span className="drp-key drp-key-pending" aria-hidden="true" />
              {labels.legendPending}
            </li>
            <li>
              <span className="drp-key drp-key-holiday" aria-hidden="true" />
              {labels.legendHoliday}
            </li>
            <li>
              <span className="drp-key drp-key-weekend" aria-hidden="true" />
              {labels.legendWeekend}
            </li>
          </ul>

          <div className="drp-foot">
            <div className="drp-fields">
              <label className="sr-only" htmlFor={`${id}-from`}>
                {labels.from}
              </label>
              <input
                id={`${id}-from`}
                type="date"
                value={lo || ''}
                onChange={(e) => {
                  if (!ISO_DATE.test(e.target.value)) return;
                  setStart(e.target.value);
                  if (!end || end < e.target.value) setEnd(e.target.value);
                  setView(monthStart(e.target.value));
                }}
              />
              <span aria-hidden="true">–</span>
              <label className="sr-only" htmlFor={`${id}-to`}>
                {labels.to}
              </label>
              <input
                id={`${id}-to`}
                type="date"
                value={end ? hi : ''}
                min={lo || undefined}
                onChange={(e) => {
                  if (!ISO_DATE.test(e.target.value)) return;
                  if (!start) setStart(e.target.value);
                  setEnd(e.target.value);
                }}
              />
            </div>
            <span className={`drp-status small${clash ? ' negative' : ' muted'}`} role="status">
              {clash ? labels.overlaps : start && !end ? labels.pickEnd : lo ? plural(labels.workingDays, working) : ''}
            </span>
            <div className="drp-actions">
              <button type="button" className="btn" onClick={cancel}>
                {labels.cancel}
              </button>
              <button type="button" className="btn btn-primary" onClick={apply} disabled={!lo || clash}>
                {labels.apply}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
