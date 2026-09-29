import Link from 'next/link';
import { fmt, holidayLabel, type Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatHours, timeOfDay } from '@/lib/format';
import type { BoardRow } from '@/server/presence';

/** One person's state today as a pill: "Working · since 09:05", "Late · 40m", "Day off"… Links to their log. */
export function PresencePill({ row, t, locale }: { row: BoardRow; t: Dict; locale: Locale }) {
  const { status, lateBy } = row.presence;
  const detail =
    (status === 'working' || status === 'break') && row.since
      ? fmt(t.today.since, { time: timeOfDay(row.since) })
      : status === 'late'
        ? formatHours(lateBy, locale)
        : status === 'on_leave' && row.leavePortion === 0.5
          ? t.today.halfDay
          : null;
  const label = status === 'off' ? (holidayLabel(locale, row.day) ?? t.dayTypes[row.day.dayType]) : t.today.status[status];
  return (
    <Link href={`/attendance/${row.employee.id}`} className={`presence presence-${status} clock-${status}`}>
      {status === 'working' || status === 'break' ? <span className="clock-dot" aria-hidden="true" /> : null}
      {label}
      {detail ? <span className="presence-detail"> · {detail}</span> : null}
    </Link>
  );
}
