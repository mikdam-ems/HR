import { signOutAction } from '@/app/actions';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandSwitch } from '@/components/BrandSwitch';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { StatusLine } from '@/components/StatusLine';
import { NavLinks } from '@/components/NavLinks';
import { listPendingSwaps } from '@/server/swaps';
import { StatusBubble } from '@/components/StatusBubble';
import { TopClock } from '@/components/Clock';
import { toClockData } from '@/lib/clockData';
import { clockView } from '@/server/clock';
import { loadRulesContext } from '@/server/rulesContext';
import { resolveDay } from '@/domain';
import { todayISO } from '@/lib/format';
import { demoMode } from '@/auth';
import { brandPreview, getBrand } from '@/brand';
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
  const [{ t, locale }, brand] = await Promise.all([getDict(), getBrand()]);
  const name = localName(locale, user.nameEn, user.nameAr);
  const approver = user.isManager || user.roles.includes('admin') || !!user.standingInFor?.length;
  const db = await getDb();
  const pending = approver
    ? (await countPendingApprovals(db, user)) + (await countPendingLeave(db, user)) + (await listPendingSwaps(db, user)).length
    : 0;
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
    ...(user.isManager || can(user, 'reports.view') ? [{ href: '/today', label: t.nav.today }] : []),
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
            <BrandLogo brand={brand} appName={t.appName} />
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
            <details className="me">
              <summary aria-label={name}>
                <Avatar person={user} status={user.status} />
              </summary>
              <div className="me-menu card">
                <strong>{name}</strong>
                <span className="muted small">{user.email}</span>
                <StatusLine status={user.status ?? null} presets={t.status.presets} />
                <div className="prefs">
                  <LanguageSwitch locale={locale} label={t.nav.language} />
                  {brandPreview ? <BrandSwitch brand={brand} labels={t.brand} /> : null}
                </div>
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
