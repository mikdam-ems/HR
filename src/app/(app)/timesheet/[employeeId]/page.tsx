import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancelDayChangeAction, resetDayAction, saveDayAction, submitMonthAction } from '@/app/(app)/timesheet/actions';
import { DayBadge } from '@/components/DayBadge';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { type MonthDay, weekdayOf } from '@/domain';
import { clientLabel, fmt, getDict, holidayLabel, localName, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import type { DayChangeRow } from '@/db/schema';
import { formatDate, formatHours, timeOfDay, todayISO } from '@/lib/format';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';
import { getSettings } from '@/server/settings';
import { getMonth, type MonthView } from '@/server/timesheets';
import { monthClock } from '@/server/clock';
import { type ClockDay, msToMinutes } from '@/domain';

const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'compensatory', 'bereavement', 'paternity', 'maternity', 'hajj'] as const;

function parseMonth(value: string | undefined): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return [Number(m[1]), Number(m[2])];
  const today = todayISO();
  return [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
}
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const shift = (y: number, m: number, by: number) => {
  const i = y * 12 + (m - 1) + by;
  return ym(Math.floor(i / 12), (i % 12) + 1);
};

export default async function TimesheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const { employeeId } = await params;
  const search = await searchParams;
  const [year, month] = parseMonth(search.month);
  const db = await getDb();

  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) notFound();
  const result = await getMonth(db, user, employeeId, year, month);
  if (!result.ok) {
    if (result.error === 'not_found') notFound();
    return (
      <div className="flash flash-error" role="alert">
        {t.errors.forbidden}
      </div>
    );
  }
  const view = result.value;
  const [ctx, appSettings, clocked] = await Promise.all([loadRulesContext(db), getSettings(db), monthClock(db, employeeId, year, month)]);
  const own = view.employee.id === user.id;
  const today = todayISO();
  const selected = view.summary.days.find((d) => d.day.date === search.day) ?? null;
  const monthKey = ym(year, month);
  const totals = view.summary.totals;
  const leaveDays = Object.values(totals.leaveDaysByType).reduce((a, b) => a + (b ?? 0), 0);
  const overtime = totals.regularOvertimeMinutes + totals.specialOvertimeMinutes + totals.offDayOvertimeMinutes;
  const changedCount = view.summary.days.filter((d) => d.changed).length;
  const title = own ? t.timesheet.title : fmt(t.timesheet.titleFor, { name: localName(locale, view.employee.nameEn, view.employee.nameAr) });
  const monthLabel = formatDate(`${monthKey}-01`, locale, { month: 'long', year: 'numeric' });
  const lead = (weekdayOf(`${monthKey}-01`) as number) % 7;
  const primary = view.summary.days.find((d) => d.day.primaryClientId)?.day;
  const approverRow = view.employee.managerId
    ? await db.query.employees.findFirst({ where: (e, { eq }) => eq(e.id, view.employee.managerId!) })
    : undefined;
  const approver = approverRow ? localName(locale, approverRow.nameEn, approverRow.nameAr) : null;
  const pendingCount = Object.keys(view.pending).length;
  const clockMode = view.summary.days.some((d) => d.source === 'clock');
  const decidedBy = view.timesheet?.decidedById ? await db.query.employees.findFirst({ where: (e, { eq }) => eq(e.id, view.timesheet!.decidedById!) }) : undefined;

  return (
    <>
      <Flash search={search} t={t} />
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <div className="row">
            <Link className="btn btn-small" href={`?month=${shift(year, month, -1)}`} aria-label={t.timesheet.prev}>
              <span aria-hidden="true" className="flip">‹</span>
            </Link>
            <h1>{monthLabel}</h1>
            <Link className="btn btn-small" href={`?month=${shift(year, month, 1)}`} aria-label={t.timesheet.next}>
              <span aria-hidden="true" className="flip">›</span>
            </Link>
            <span className={`badge status-${view.status}`}>{t.timesheet.status[view.status]}</span>
            {view.closed ? <span className="badge">{t.timesheet.status.closed}</span> : null}
          </div>
          <span className="muted">
            {title}
            {primary?.primaryClientId ? ` · ${clientLabel(locale, ctx.clients, [primary.primaryClientId])}` : ''}
            {primary?.schedule ? (
              <>
                {' · '}
                <bdi dir="ltr">{`${primary.schedule.start}–${primary.schedule.end}`}</bdi>
              </>
            ) : null}
          </span>
        </div>
        <div className="row">
          <Link className="btn" href={`/attendance/${view.employee.id}?month=${monthKey}`}>
            {t.timesheet.attendance}
          </Link>
          {view.access.edit ? (
            <form action={submitMonthAction}>
              <input type="hidden" name="month" value={monthKey} />
              <button className="btn btn-primary">{t.timesheet.submit}</button>
            </form>
          ) : null}
        </div>
      </div>

      <StatusNote view={view} t={t} locale={locale} decidedBy={decidedBy ? localName(locale, decidedBy.nameEn, decidedBy.nameAr) : ''} />
      {view.access.edit && view.status === 'draft' ? (
        <p className="muted" style={{ margin: 0 }}>
          {clockMode ? t.timesheet.introClock : t.timesheet.intro}
        </p>
      ) : null}
      {pendingCount ? (
        <div className="flash flash-info" role="status">
          {fmt(t.timesheet.pendingCount, { count: pendingCount })}
        </div>
      ) : null}

      <div className="stats">
        <Stat label={t.timesheet.workingDays} value={String(totals.workingDays)} />
        <Stat
          label={t.timesheet.hoursWorked}
          value={formatHours(totals.workedMinutes, locale)}
          sub={fmt(t.timesheet.ofExpected, { n: formatHours(totals.expectedMinutes, locale) })}
        />
        <Stat
          label={t.timesheet.leave}
          value={fmt(t.timesheet.days, { n: leaveDays })}
          sub={Object.entries(totals.leaveDaysByType)
            .map(([k, v]) => `${v} ${t.timesheet.leaveTypes[k as keyof Dict['timesheet']['leaveTypes']]}`)
            .join(' · ')}
        />
        <Stat
          label={t.timesheet.overtime}
          value={formatHours(overtime, locale)}
          sub={overtime ? fmt(t.timesheet.weighted, { n: formatHours(Math.round(totals.weightedOvertimeMinutes), locale) }) : undefined}
        />
        <Stat label={t.timesheet.changed} value={String(changedCount)} highlight={changedCount > 0} />
      </div>

      <div className="ts-layout">
        <div className="stack">
          <div className="month-grid" role="grid" aria-label={monthLabel}>
            {t.weekdays.map((w) => (
              <div key={w} className="month-head" role="columnheader">
                {w}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`lead-${i}`} className="cell cell-empty" aria-hidden="true" />
            ))}
            {view.summary.days.map((d) => (
              <DayCell key={d.day.date} d={d} t={t} locale={locale} monthKey={monthKey} today={today} selected={d.day.date === selected?.day.date} pending={!!view.pending[d.day.date]} clock={clocked[d.day.date]} />
            ))}
          </div>
          <div className="legend">
            {(['working', 'weekend', 'client_holiday', 'special_overtime'] as const).map((k) => (
              <span key={k}>
                <i className={`swatch day-${k}`} />
                {t.dayTypes[k]}
              </span>
            ))}
            <span>
              <i className="swatch day-leave" />
              {t.timesheet.leaveTypes.annual}
            </span>
            <span>
              <i className="swatch day-sick" />
              {t.timesheet.leaveTypes.sick}
            </span>
          </div>
        </div>

        <aside className="card day-panel" aria-label={selected ? formatDate(selected.day.date, locale) : t.timesheet.checks}>
          {selected ? (
            <DayPanel d={selected} view={view} t={t} locale={locale} clientNames={(ids) => clientLabel(locale, ctx.clients, ids)} rate={appSettings.overtimeRates.special} approver={approver} clock={clocked[selected.day.date]} />
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {t.timesheet.day.pick}
              </p>
              <h2>{t.timesheet.checks}</h2>
              {view.summary.issues.length ? (
                <ul className="issues">
                  {view.summary.issues.map((i) => (
                    <li key={`${i.date}-${i.code}`}>
                      <Link href={`?month=${monthKey}&day=${i.date}`}>{formatDate(i.date, locale, { day: 'numeric', month: 'short' })}</Link>:{' '}
                      {t.timesheet.issues[i.code]}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">{t.timesheet.noIssues}</span>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong className={highlight ? 'stat-highlight' : undefined}>{value}</strong>
      {sub ? <span className="muted small">{sub}</span> : null}
    </div>
  );
}

function StatusNote({ view, t, locale, decidedBy }: { view: MonthView; t: Dict; locale: Locale; decidedBy: string }) {
  const ts = view.timesheet;
  if (!ts) return null;
  const when = (d: Date | null) => (d ? formatDate(d.toISOString().slice(0, 10), locale) : '');
  if (view.status === 'submitted') return <div className="flash flash-info">{fmt(t.timesheet.submittedOn, { date: when(ts.submittedAt) })}</div>;
  if (view.status === 'approved') return <div className="flash">{fmt(t.timesheet.approvedBy, { name: decidedBy, date: when(ts.decidedAt) })}</div>;
  if (view.status === 'returned')
    return (
      <div className="flash flash-error" role="alert">
        <strong>{fmt(t.timesheet.returnedBy, { name: decidedBy })}</strong> {ts.managerNote}
      </div>
    );
  return null;
}

function cellKind(d: MonthDay): string {
  if (d.entry.leave) return d.entry.leave.type === 'sick' ? 'sick' : 'leave';
  return d.day.dayType;
}

function DayCell({
  d,
  t,
  locale,
  monthKey,
  today,
  selected,
  pending,
  clock,
}: {
  d: MonthDay;
  t: Dict;
  locale: Locale;
  monthKey: string;
  today: string;
  selected: boolean;
  pending: boolean;
  clock?: ClockDay;
}) {
  const date = d.day.date;
  const kind = cellKind(d);
  const label = d.entry.leave
    ? t.timesheet.leaveTypes[d.entry.leave.type] + (d.entry.leave.portion === 0.5 ? ` · ${t.timesheet.day.half}` : '')
    : (holidayLabel(locale, d.day) ?? t.dayTypes[d.day.dayType]);
  const future = date > today;
  const worked = d.entry.workedMinutes;
  const extra = d.totals.regularOvertimeMinutes;
  return (
    <Link
      href={`?month=${monthKey}&day=${date}`}
      className={`cell day-${kind}${selected ? ' cell-selected' : ''}${pending ? ' cell-has-pending' : ''}`}
      aria-current={selected ? 'date' : undefined}
      scroll={false}
    >
      <span className="cell-top">
        <span className={date === today ? 'cell-num cell-today' : 'cell-num'}>{Number(date.slice(8))}</span>
        {pending ? (
          <span className="cell-pending">{t.timesheet.pending}</span>
        ) : d.changed ? (
          <span className="cell-edited">{t.timesheet.edited}</span>
        ) : null}
      </span>
      <span className="cell-label">{label}</span>
      <span className="cell-hours">
        {worked ? formatHours(worked, locale) : '—'}
        {future && worked && !d.changed ? <span className="muted small"> {t.timesheet.planned}</span> : null}
        {extra ? <span className="cell-extra"> +{formatHours(extra, locale)}</span> : null}
      </span>
      {clock && (d.source === 'schedule' || d.changed) ? (
        <span className="cell-clock" title={t.clock.clocked}>
          ⏱ {formatHours(msToMinutes(clock.workedMs), locale)}
        </span>
      ) : null}
    </Link>
  );
}

function DayPanel({
  d,
  view,
  t,
  locale,
  clientNames,
  rate,
  approver,
  clock,
}: {
  d: MonthDay;
  view: MonthView;
  t: Dict;
  locale: Locale;
  clientNames: (ids: string[]) => string;
  rate: number;
  approver: string | null;
  clock?: ClockDay;
}) {
  const date = d.day.date;
  const pending = view.pending[date];
  const time = view.times[date];
  const sched = d.day.schedule;
  const isWorkday = d.day.dayType === 'working' || d.day.dayType === 'special_overtime';
  const start = (pending?.action === 'set' ? pending.startTime : time?.start) ?? (isWorkday && sched ? sched.start : '');
  const end = (pending?.action === 'set' ? pending.endTime : time?.end) ?? (isWorkday && sched ? sched.end : '');
  const leaveNow = pending?.action === 'set' ? pending.leaveType : (d.entry.leave?.type ?? null);
  const portionNow = pending?.action === 'set' ? pending.leavePortion : (d.entry.leave?.portion ?? null);
  const noteNow = pending?.action === 'set' ? pending.note : view.notes[date];
  const ot = d.totals;
  const otText = ot.regularOvertimeMinutes
    ? `${formatHours(ot.regularOvertimeMinutes, locale)} · ${t.timesheet.day.regular}`
    : ot.specialOvertimeMinutes
      ? `${formatHours(ot.specialOvertimeMinutes, locale)} · ${fmt(t.timesheet.day.special, { rate })}`
      : ot.offDayOvertimeMinutes
        ? `${formatHours(ot.offDayOvertimeMinutes, locale)} · ${t.timesheet.day.offDay}`
        : t.timesheet.day.none;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        {d.changed ? <span className="badge badge-special_overtime">{t.timesheet.edited}</span> : null}
      </div>
      <DayBadge type={d.day.dayType} t={t} holiday={holidayLabel(locale, d.day)} />
      <p className="muted small" style={{ margin: 0 }}>
        {fmt(t.dayTypeHints[d.day.dayType], { rate })}
      </p>
      {d.issues.length ? (
        <ul className="issues">
          {d.issues.map((i) => (
            <li key={i.code}>{t.timesheet.issues[i.code]}</li>
          ))}
        </ul>
      ) : null}

      <dl className="facts">
        <div>
          <dt>{t.timesheet.day.client}</dt>
          <dd>{clientNames(d.day.clientIds) || t.timesheet.day.none}</dd>
        </div>
        <div>
          <dt>{t.timesheet.day.worked}</dt>
          <dd>{formatHours(d.entry.workedMinutes, locale)}</dd>
        </div>
        <div>
          <dt>{t.timesheet.day.overtime}</dt>
          <dd>{otText}</dd>
        </div>
        <div>
          <dt>{t.clock.clocked}</dt>
          <dd>
            {clock ? (
              <>
                <bdi dir="ltr">
                  {timeOfDay(clock.firstIn)}–{clock.lastOut ? timeOfDay(clock.lastOut) : '…'}
                </bdi>{' '}
                · {formatHours(msToMinutes(clock.workedMs), locale)}
                {clock.open ? ` (${t.clock.stillOpen})` : ''}
              </>
            ) : (
              t.clock.noClock
            )}
          </dd>
        </div>
        <div>
          <dt>{t.timesheet.day.leave}</dt>
          <dd>{d.entry.leave ? t.timesheet.leaveTypes[d.entry.leave.type] : t.timesheet.day.none}</dd>
        </div>
      </dl>

      {view.access.edit && d.source === 'schedule' && clock && !clock.open && date < todayISO() && !d.entry.leave && Math.abs(msToMinutes(clock.workedMs) - d.entry.workedMinutes) >= 15 ? (
        <form action={saveDayAction}>
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="workedMinutes" value={msToMinutes(clock.workedMs)} />
          <input
            type="hidden"
            name="note"
            value={fmt(t.clock.useClockedNote, { start: timeOfDay(clock.firstIn), end: clock.lastOut ? timeOfDay(clock.lastOut) : '' })}
          />
          <button className="btn btn-small" style={{ width: '100%' }}>
            ⏱ {fmt(t.clock.useClocked, { hours: formatHours(msToMinutes(clock.workedMs), locale) })}
          </button>
        </form>
      ) : null}
      {pending ? <PendingNote req={pending} t={t} locale={locale} approver={approver} canWithdraw={view.access.edit} /> : null}

      {view.access.edit ? (
        <>
          {approver ? <span className="muted small">{fmt(t.timesheet.day.approvalHint, { name: approver })}</span> : null}
          <form action={saveDayAction} className="stack" key={date}>
            <input type="hidden" name="date" value={date} />
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="startTime">{t.timesheet.day.start}</label>
                <input id="startTime" name="startTime" type="time" defaultValue={start} />
              </div>
              <div className="field">
                <label htmlFor="endTime">{t.timesheet.day.end}</label>
                <input id="endTime" name="endTime" type="time" defaultValue={end} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="leaveType">{t.timesheet.day.leave}</label>
              <select id="leaveType" name="leaveType" defaultValue={leaveNow ?? ''}>
                <option value="">{t.timesheet.day.noLeave}</option>
                {LEAVE_TYPES.map((l) => (
                  <option key={l} value={l}>
                    {t.timesheet.leaveTypes[l]}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="row" style={{ gap: 16 }}>
              <legend className="sr-only">{t.timesheet.day.leave}</legend>
              <label className="check">
                <input type="radio" name="leavePortion" value="1" defaultChecked={portionNow !== 0.5} />
                {t.timesheet.day.full}
              </label>
              <label className="check">
                <input type="radio" name="leavePortion" value="0.5" defaultChecked={portionNow === 0.5} />
                {t.timesheet.day.half}
              </label>
            </fieldset>
            <div className="field">
              <label htmlFor="note">{t.timesheet.day.note}</label>
              <textarea id="note" name="note" rows={3} maxLength={500} defaultValue={noteNow ?? ''} placeholder={t.timesheet.day.notePlaceholder} />
            </div>
            <button className="btn btn-primary">{approver ? t.timesheet.day.send : t.timesheet.day.save}</button>
          </form>
          {d.changed && pending?.action !== 'reset' ? (
            <form action={resetDayAction}>
              <input type="hidden" name="date" value={date} />
              <button className="btn" style={{ width: '100%' }}>
                {d.source === 'clock'
                  ? approver
                    ? t.timesheet.day.askResetClock
                    : t.timesheet.day.resetClock
                  : approver
                    ? t.timesheet.day.askReset
                    : t.timesheet.day.reset}
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <>
          {view.notes[date] ? <p style={{ margin: 0 }}>“{view.notes[date]}”</p> : null}
          {view.status === 'submitted' || view.status === 'approved' ? (
            <span className="muted small">{fmt(t.timesheet.day.readOnly, { status: t.timesheet.status[view.status] })}</span>
          ) : null}
        </>
      )}
    </>
  );
}

function PendingNote({
  req,
  t,
  locale,
  approver,
  canWithdraw,
}: {
  req: DayChangeRow;
  t: Dict;
  locale: Locale;
  approver: string | null;
  canWithdraw: boolean;
}) {
  const what =
    req.action === 'reset'
      ? t.timesheet.day.pendingReset
      : [
          req.leaveType ? t.timesheet.leaveTypes[req.leaveType] + (req.leavePortion === 0.5 ? ` · ${t.timesheet.day.half}` : '') : null,
          req.workedMinutes || !req.leaveType ? formatHours(req.workedMinutes, locale) : null,
          req.note ? `“${req.note}”` : null,
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <div className="pending-note">
      <strong>{fmt(t.timesheet.day.pendingTitle, { name: approver ?? '' })}</strong>
      <span className="small">{fmt(t.timesheet.day.pendingBody, { what })}</span>
      {canWithdraw ? (
        <form action={cancelDayChangeAction}>
          <input type="hidden" name="id" value={req.id} />
          <input type="hidden" name="date" value={req.date} />
          <button className="btn btn-small">{t.timesheet.day.withdraw}</button>
        </form>
      ) : null}
    </div>
  );
}
