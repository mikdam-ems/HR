import { cookies } from 'next/headers';

/**
 * Which brand the app wears: 'ems' (EMS People & Culture, today's look) or 'kadr' (the proposed product brand,
 * see docs/brand/kadr). Only the look and the app name change; features and data are the same.
 */
export type Brand = 'ems' | 'kadr';
export const BRAND_COOKIE = 'brand';

/** BRAND=kadr makes Kadr the default for this deployment. */
export const defaultBrand: Brand = process.env.BRAND === 'kadr' ? 'kadr' : 'ems';

/**
 * BRAND_PREVIEW=true lets each person switch brands to compare them. Demo sites always allow it; the live EMS
 * site doesn't, so staff in the pilot keep seeing People & Culture.
 */
export const brandPreview = process.env.BRAND_PREVIEW === 'true' || process.env.DEMO_MODE === 'true';

/** The brand to show, from the person's saved choice (only honoured while preview is on) or the default. */
export function resolveBrand(saved: string | undefined, opts: { preview: boolean; fallback: Brand }): Brand {
  if (opts.preview && (saved === 'ems' || saved === 'kadr')) return saved;
  return opts.fallback;
}

export async function getBrand(): Promise<Brand> {
  return resolveBrand((await cookies()).get(BRAND_COOKIE)?.value, { preview: brandPreview, fallback: defaultBrand });
}
