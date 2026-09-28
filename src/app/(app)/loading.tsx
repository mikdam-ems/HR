/** Shown instantly while a page loads, so a click always gets an immediate response. */
export default function Loading() {
  return (
    <div className="page-loading" aria-busy="true" aria-live="polite">
      <div className="skeleton skeleton-title" />
      <div className="bento">
        <div className="skeleton span-6" style={{ height: 220 }} />
        <div className="skeleton span-6" style={{ height: 220 }} />
        <div className="skeleton span-12" style={{ height: 160 }} />
      </div>
    </div>
  );
}
