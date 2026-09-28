import { setLocaleAction, signOutAction } from '@/app/actions';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmsLogo } from '@/components/EmsLogo';
import { BackField, NavLinks } from '@/components/NavLinks';
import { StatusBubble } from '@/components/StatusBubble';
import { TopClock } from '@/components/Clock';
import { toClockData } from '@/lib/clockData';
import { clockView } from '@/server/clock';
import { loadRulesContext } from '@/server/rulesContext';
import { resolveDay } from '@/domain';
import { todayISO } from '@/lib/format';
import { demoMode } from '@/auth';
import { getDict, localName } from '@/i18n';
import { can } from '@/server/permissions';
import { getDb } from '@/db';
import { requireUser } from '@/server/session';
import { countPendingLeave } from '@/server/leave';
import { countPendingApprovals } from '@/server/timesheets';
import { NotificationBell } from '@/components/NotificationBell';
import { notificationText, type NotificationKind } from '@/lib/notificationText';
import { formatDate, timeOfDay } from '@/lib/format';
import { countUnread, listNotifications } from '@/server/notify';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const name = localName(locale, user.nameEn, user.nameAr);
  const approver = user.isManager || user.roles.includes('admin');
  const db = await getDb();
  const pending = approver ? (await countPendingApprovals(db, user)) + (await countPendingLeave(db, user)) : 0;
  const [myClock, ctx, recent, unread] = await Promise.all([
    clockView(db, user.id),
    loadRulesContext(db),
    listNotifications(db, user.id, 12),
    countUnread(db, user.id),
  ]);
  const bellItems = recent.map((n) => ({
    id: n.id,
    ...notificationText(t, locale, n.kind as NotificationKind, n.data as Record<string, unknown>),
    when: `${formatDate(todayISO(n.createdAt), locale, { day: 'numeric', month: 'short' })} · ${timeOfDay(n.createdAt)}`,
    unread: !n.readAt,
  }));
  const clockData = toClockData(myClock, locale, resolveDay(ctx, user.id, todayISO()).expectedMinutes);
  const links = [
    { href: '/', label: t.nav.home },
    { href: '/timesheet', label: t.nav.timesheet },
    { href: '/time-off', label: t.nav.timeOff },
    ...(approver
      ? [{ href: '/approvals', label: t.nav.approvals, badge: pending || undefined }]
      : []),
    { href: '/people', label: t.nav.people },
    ...(can(user, 'reports.view') ? [{ href: '/reports', label: t.nav.reports }] : []),
    ...(can(user, 'clients.manage') ? [{ href: '/clients', label: t.nav.clients }] : []),
    ...(can(user, 'settings.manage') ? [{ href: '/settings', label: t.nav.settings }] : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <EmsLogo />
            <span className="divider" aria-hidden="true" />
            <span className="brand-name">{t.appName}</span>
          </Link>
          <nav className="topnav" aria-label="Main">
            <NavLinks links={links} />
          </nav>
          <div className="topbar-end">
            <TopClock data={clockData} labels={t.clock} />
            <NotificationBell
              items={bellItems}
              unread={unread}
              vapidKey={process.env.VAPID_PUBLIC_KEY ?? null}
              labels={t.notifications}
            />
            <details className="lang">
              <summary aria-label={t.nav.language} title={t.nav.language}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.4-2.4 3.6-5.4 3.6-9S14.4 5.4 12 3m0 18c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3M3.6 9h16.8M3.6 15h16.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span lang={locale}>{locale === 'ar' ? 'ع' : 'EN'}</span>
              </summary>
              <form action={setLocaleAction} className="lang-menu card">
                <BackField />
                <button name="locale" value="en" aria-pressed={locale === 'en'} lang="en">
                  English
                </button>
                <button name="locale" value="ar" aria-pressed={locale === 'ar'} lang="ar">
                  العربية
                </button>
              </form>
            </details>
            <details className="me">
              <summary aria-label={name}>
                <Avatar person={user} status={user.status} />
              </summary>
              <div className="me-menu card">
                <strong>{name}</strong>
                <span className="muted small">{user.email}</span>
                <Link className="btn btn-small" href="/profile">
                  {t.nav.profile}
                </Link>
                <form action={signOutAction}>
                  <button className="btn btn-small">{t.nav.signOut}</button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="main">
        {demoMode ? (
          <div className="demo-banner" role="note">
            {t.demo.banner}
          </div>
        ) : null}
        {children}
      </main>
      <StatusBubble status={user.status ?? null} labels={t.status} />
    </div>
  );
}
