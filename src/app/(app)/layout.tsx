import { setLocaleAction, signOutAction } from '@/app/actions';
import { BackField, NavLinks } from '@/components/NavLinks';
import { demoMode } from '@/auth';
import { getDict, localName } from '@/i18n';
import { can } from '@/server/permissions';
import { getDb } from '@/db';
import { requireUser } from '@/server/session';
import { countPendingLeave } from '@/server/leave';
import { countPendingApprovals } from '@/server/timesheets';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const name = localName(locale, user.nameEn, user.nameAr);
  const initials = user.nameEn
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const approver = user.isManager || user.roles.includes('admin');
  const db = approver ? await getDb() : null;
  const pending = db ? (await countPendingApprovals(db, user)) + (await countPendingLeave(db, user)) : 0;
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
          <div className="brand">
            <span className="wordmark" aria-label="ems">
              <span>e</span>ms
            </span>
            <span className="divider" aria-hidden="true" />
            <span className="brand-name">{t.appName}</span>
          </div>
          <nav className="topnav" aria-label="Main">
            <NavLinks links={links} />
          </nav>
          <div className="topbar-end">
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
                <span className="avatar" aria-hidden="true">
                  {initials}
                </span>
              </summary>
              <div className="me-menu card">
                <strong>{name}</strong>
                <span className="muted small">{user.email}</span>
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
    </div>
  );
}
