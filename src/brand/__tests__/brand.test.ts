import { describe, expect, it } from 'vitest';
import { resolveBrand } from '@/brand';

describe('resolveBrand', () => {
  it('uses the saved choice while preview is on', () => {
    expect(resolveBrand('kadr', { preview: true, fallback: 'ems' })).toBe('kadr');
    expect(resolveBrand('ems', { preview: true, fallback: 'kadr' })).toBe('ems');
  });

  it('ignores the saved choice when preview is off, so the live site keeps its brand', () => {
    expect(resolveBrand('kadr', { preview: false, fallback: 'ems' })).toBe('ems');
  });

  it('falls back to the default for a missing or unknown value', () => {
    expect(resolveBrand(undefined, { preview: true, fallback: 'kadr' })).toBe('kadr');
    expect(resolveBrand('acme', { preview: true, fallback: 'ems' })).toBe('ems');
  });
});
