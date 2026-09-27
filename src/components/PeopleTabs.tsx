import Link from 'next/link';
import type { Dict } from '@/i18n/en';

/** List · Org chart · Departments — the three views of People. */
export function PeopleTabs({ t, current, query = '' }: { t: Dict; current: 'list' | 'chart' | 'departments'; query?: string }) {
  const q = query ? `&${query}` : '';
  return (
    <nav className="segmented" aria-label={t.people.title}>
      <Link href={`/people?view=list${q}`} aria-current={current === 'list'}>
        {t.people.list}
      </Link>
      <Link href={`/people?view=chart${q}`} aria-current={current === 'chart'}>
        {t.people.chart}
      </Link>
      <Link href="/people/departments" aria-current={current === 'departments'}>
        {t.people.departments}
      </Link>
    </nav>
  );
}
