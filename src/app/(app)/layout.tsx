import { setLocaleAction, signOutAction } from '@/app/actions';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandSwitch } from '@/components/BrandSwitch';
import { BackField, NavLinks } from '@/components/NavLinks';
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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ t, locale }, brand] = await Promise.all([getDict(), getBrand()]);
  const name = localName(locale, user.nameEn, user.nameAr);
  const approver = user.isManager || user.roles.includes('admin');
  const db = await getDb();
  const pending = approver ? (await countPendingApprovals(db, user)) + (await countPendingLeave(db, user)) : 0;
  const [myClock, ctx] = await Promise.all([clockView(db, user.id), loadRulesContext(db)]);
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
            <BrandLogo brand={brand} appName={t.appName} />
          </Link>
          <nav className="topnav" aria-label="Main">
            <NavLinks links={links} />
          </nav>
          <div className="topbar-end">
            <TopClock data={clockData} labels={t.clock} />
            <form action={setLocaleAction} className="segmented" aria-label={t.nav.language}>
              <BackField />
              <button name="locale" value="en" aria-pressed={locale === 'en'} lang="en">
                EN
              </button>
              <button name="locale" value="ar" aria-pressed={locale === 'ar'} lang="ar">
                عربي
              </button>
            </form>
            <details className="me">
              <summary aria-label={name}>
                <Avatar person={user} status={user.status} />
              </summary>
              <div className="me-menu card">
                <strong>{name}</strong>
                <span className="muted small">{user.email}</span>
                {brandPreview ? <BrandSwitch brand={brand} labels={t.brand} /> : null}
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
