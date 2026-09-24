'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export function NavLinks({ links }: { links: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className="nav-link" aria-current={active ? 'page' : undefined}>
            {l.label}
            {l.badge ? <span className="nav-badge">{l.badge}</span> : null}
          </Link>
        );
      })}
    </>
  );
}

/** Hidden input carrying the current path, so the language switch returns to the same page. */
export function BackField() {
  const path = usePathname();
  const query = useSearchParams().toString();
  return <input type="hidden" name="back" value={query ? `${path}?${query}` : path} />;
}
