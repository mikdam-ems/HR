import type { Locale } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate } from './format';

export type NotificationKind =
  | 'leave_requested'
  | 'leave_decided'
  | 'day_change_requested'
  | 'day_change_decided'
  | 'month_submitted'
  | 'month_decided'
  | 'timesheet_reminder';

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** The title and body of a notification in the reader's language. */
export function notificationText(
  t: Dict,
  locale: Locale,
  kind: NotificationKind,
  data: Record<string, unknown>,
): { title: string; body: string } {
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : '');
  const date = (k: string) => (str(k) ? formatDate(str(k), locale, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const month = str('month') ? formatDate(`${str('month')}-01`, locale, { month: 'long', year: 'numeric' }) : '';
  const vars: Record<string, string> = {
    name: (locale === 'ar' && str('nameAr')) || str('name'),
    by: str('by'),
    note: str('note'),
    date: date('date'),
    dates: str('to') && str('to') !== str('from') ? `${date('from')} – ${date('to')}` : date('from'),
    month,
    type: t.timesheet.leaveTypes[str('type') as keyof Dict['timesheet']['leaveTypes']] ?? '',
    outcome: t.notifications.outcomes[str('outcome') as keyof Dict['notifications']['outcomes']] ?? str('outcome'),
  };
  const words = t.notifications.kinds[kind];
  return { title: fill(words.title, vars), body: fill(words.body, vars).replace(/\s·\s$/, '') };
}
