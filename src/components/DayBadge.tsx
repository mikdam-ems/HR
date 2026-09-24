import type { DayType } from '@/domain';
import type { Dict } from '@/i18n/en';

export function DayBadge({ type, t, holiday }: { type: DayType; t: Dict; holiday?: string }) {
  return (
    <span className={`badge badge-${type}`}>
      {t.dayTypes[type]}
      {holiday ? ` · ${holiday}` : ''}
    </span>
  );
}
