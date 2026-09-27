'use client';

/** Shown when a page fails (for example, the database can't be reached). Bilingual: the language cookie may be unreadable here. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="signin">
      <div className="card" role="alert">
        <h1>Something went wrong · حدث خطأ</h1>
        <p className="muted" style={{ margin: 0 }}>
          The page couldn’t load. If this keeps happening, open <a href="/api/health">/api/health</a> and send what it
          shows to the person who runs the site.
        </p>
        {error.digest ? <span className="muted small">Reference: {error.digest}</span> : null}
        <button className="btn btn-primary" onClick={reset}>
          Try again · حاول مجدداً
        </button>
      </div>
    </div>
  );
}
