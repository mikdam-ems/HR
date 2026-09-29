import { setLocaleAction } from '@/app/actions';
import { BackField } from '@/components/NavLinks';
import type { Locale } from '@/i18n';

/** English / Arabic, for the account menu and My profile. Returns to the page it was used on. */
export function LanguageSwitch({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action={setLocaleAction} className="pref-switch">
      <BackField />
      <span className="muted small">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        <button name="locale" value="en" aria-pressed={locale === 'en'} lang="en">
          English
        </button>
        <button name="locale" value="ar" aria-pressed={locale === 'ar'} lang="ar">
          العربية
        </button>
      </div>
    </form>
  );
}
