import type { Dict } from '@/i18n/en';

type Search = Record<string, string | string[] | undefined>;

/** Shows the ?ok= / ?error= message a form action redirected with. */
export function Flash({ search, t }: { search: Search; t: Dict }) {
  const ok = typeof search.ok === 'string' ? search.ok : null;
  const error = typeof search.error === 'string' ? search.error : null;
  const detail = typeof search.detail === 'string' ? search.detail : null;

  if (error) {
    const message = t.errors[error as keyof Dict['errors']] ?? t.errors.invalid_input;
    return (
      <div className="flash flash-error" role="alert">
        {message}
        {detail ? <span className="small"> ({detail})</span> : null}
      </div>
    );
  }
  if (ok) {
    return (
      <div className="flash" role="status">
        {t.flash[ok as keyof Dict['flash']] ?? t.flash.saved}
      </div>
    );
  }
  return null;
}
