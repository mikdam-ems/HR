import { redirect } from 'next/navigation';
import { setLocaleAction, signInDevAction, signInGoogleAction } from '@/app/actions';
import { devLoginEnabled } from '@/auth';
import { getDb } from '@/db';
import { getDict } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { listEmployees } from '@/server/people';
import { getCurrentUser } from '@/server/session';

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getCurrentUser()) redirect('/');
  const { t, locale } = await getDict();
  const { error } = await searchParams;
  const errorText = error
    ? (t.signIn.errors[error as keyof Dict['signIn']['errors']] ?? t.signIn.errors.default)
    : null;
  const people = devLoginEnabled ? await listEmployees(await getDb()) : [];

  return (
    <div className="signin">
      <div className="card">
        <div className="brand" style={{ padding: 0 }}>
          <span className="wordmark" aria-label="ems">
            <span>e</span>ms
          </span>
          <span className="divider" aria-hidden="true" />
          <span>{t.appName}</span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <h1>{t.signIn.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t.signIn.subtitle}
          </p>
        </div>
        {errorText ? (
          <div className="flash flash-error" role="alert">
            {errorText}
          </div>
        ) : null}
        <form action={signInGoogleAction}>
          <button className="btn btn-primary" style={{ width: '100%' }}>
            {t.signIn.google}
          </button>
        </form>

        {devLoginEnabled ? (
          <form action={signInDevAction} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="field">
              <label htmlFor="dev-email">{t.signIn.devTitle}</label>
              <select id="dev-email" name="email" required>
                {people.map((p) => (
                  <option key={p.id} value={p.email}>
                    {p.nameEn} — {p.email}
                  </option>
                ))}
              </select>
              <span className="muted small">{t.signIn.devHint}</span>
            </div>
            <button className="btn">{t.signIn.devButton}</button>
          </form>
        ) : null}

        <form action={setLocaleAction} className="segmented" style={{ alignSelf: 'center' }}>
          <input type="hidden" name="back" value="/signin" />
          <button name="locale" value="en" aria-pressed={locale === 'en'} lang="en">
            English
          </button>
          <button name="locale" value="ar" aria-pressed={locale === 'ar'} lang="ar">
            العربية
          </button>
        </form>
      </div>
    </div>
  );
}
