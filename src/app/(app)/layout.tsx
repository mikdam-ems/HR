import { setLocaleAction, signOutAction } from '@/app/actions';
import { BackField, NavLinks } from '@/components/NavLinks';
import { getDict, localName } from '@/i18n';
import { can } from '@/server/permissions';
import { getDb } from '@/db';
import { requireUser } from '@/server/session';
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

  const pending = user.isManager || user.roles.includes('admin') ? await countPendingApprovals(await getDb(), user) : 0;
  const links = [
    { href: '/', label: t.nav.home },
    { href: '/timesheet', label: t.nav.timesheet },
    ...(user.isManager || user.roles.includes('admin')
      ? [{ href: '/approvals', label: t.nav.approvals, badge: pending || undefined }]
      : []),
    { href: '/people', label: t.nav.people },
    ...(can(user, 'clients.manage') ? [{ href: '/clients', label: t.nav.clients }] : []),
    ...(can(user, 'settings.manage') ? [{ href: '/settings', label: t.nav.settings }] : []),
  ];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="wordmark" aria-label="ems">
            <span>e</span>ms
          </span>
          <span className="divider" aria-hidden="true" />
          <span>{t.appName}</span>
        </div>
        <NavLinks links={links} />
        <div className="spacer" />
        <form action={setLocaleAction} className="segmented" aria-label={t.nav.language}>
          <BackField />
          <button name="locale" value="en" aria-pressed={locale === 'en'} lang="en">
            English
          </button>
          <button name="locale" value="ar" aria-pressed={locale === 'ar'} lang="ar">
            العربية
          </button>
        </form>
        <div className="me">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <div className="stack" style={{ gap: 0, minWidth: 0 }}>
            <strong style={{ fontWeight: 500 }}>{name}</strong>
            <form action={signOutAction}>
              <button className="btn-link small">{t.nav.signOut}</button>
            </form>
          </div>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
