/**
 * The EMS logo (Emerging Management Services). The files are 73×32, so they are shown at that size;
 * a larger PNG or an SVG would keep it sharp on high-resolution screens.
 * Use variant="white" on dark surfaces.
 */
export function EmsLogo({ variant = 'color' }: { variant?: 'color' | 'white' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="ems-logo"
      src={variant === 'white' ? '/brand/ems-logo-white.png' : '/brand/ems-logo.png'}
      alt="EMS — Emerging Management Services"
      width={73}
      height={32}
    />
  );
}
