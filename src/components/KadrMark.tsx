/**
 * The Kadr mark: a team on a 3×3 grid with one person moved out to a client (the saffron square).
 * Colours come from --kadr-mark and --kadr-placed, so the same mark works on light and dark surfaces.
 * Never mirrored, even in Arabic.
 */
export function KadrMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="kadr-mark"
      viewBox="0 0 54 48"
      width={size}
      height={Math.round((size * 48) / 54)}
      role="img"
      aria-label="Kadr"
    >
      <g fill="var(--kadr-mark)">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <rect x="18" y="2" width="12" height="12" rx="2" />
        <rect x="34" y="2" width="12" height="12" rx="2" />
        <rect x="2" y="18" width="12" height="12" rx="2" />
        <rect x="18" y="18" width="12" height="12" rx="2" />
        <rect x="2" y="34" width="12" height="12" rx="2" />
        <rect x="18" y="34" width="12" height="12" rx="2" />
        <rect x="34" y="34" width="12" height="12" rx="2" />
      </g>
      <rect x="40" y="18" width="12" height="12" rx="2" fill="var(--kadr-placed)" />
    </svg>
  );
}
