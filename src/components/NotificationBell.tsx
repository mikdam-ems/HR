import { markAllReadAction } from '@/app/(app)/notifications/actions';
import { BackField } from './NavLinks';
import { PushToggle, type PushLabels } from './PushToggle';

export interface BellItem {
  id: string;
  title: string;
  body: string;
  when: string;
  unread: boolean;
}

export function NotificationBell({
  items,
  unread,
  vapidKey,
  labels,
}: {
  items: BellItem[];
  unread: number;
  vapidKey: string | null;
  labels: PushLabels & { title: string; empty: string; markAllRead: string; unread: string };
}) {
  return (
    <details className="bell">
      <summary aria-label={unread ? `${labels.title} · ${labels.unread.replace('{count}', String(unread))}` : labels.title}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread ? <span className="bell-count">{unread > 9 ? '9+' : unread}</span> : null}
      </summary>
      <div className="bell-menu card">
        <div className="bell-head">
          <strong>{labels.title}</strong>
          {unread ? (
            <form action={markAllReadAction}>
              <BackField />
              <button className="bell-clear">{labels.markAllRead}</button>
            </form>
          ) : null}
        </div>
        {items.length ? (
          <ul className="bell-list">
            {items.map((n) => (
              <li key={n.id} className={n.unread ? 'unread' : undefined}>
                <a href={`/notifications/${n.id}`}>
                  <span className="bell-title">{n.title}</span>
                  {n.body ? <span className="muted small">{n.body}</span> : null}
                  <span className="muted small">{n.when}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{labels.empty}</p>
        )}
        {vapidKey ? <PushToggle vapidKey={vapidKey} labels={labels} /> : null}
      </div>
    </details>
  );
}
