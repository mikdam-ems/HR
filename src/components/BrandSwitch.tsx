import { setBrandAction } from '@/app/actions';
import type { Brand } from '@/brand';
import { BackField } from '@/components/NavLinks';
import type { Dict } from '@/i18n/en';

/**
 * Switch between the current EMS look and the proposed Kadr brand. Hidden when BRAND_PREVIEW=false.
 * Returns to `back`, or to the current page when it's not given.
 */
export function BrandSwitch({ brand, labels, back }: { brand: Brand; labels: Dict['brand']; back?: string }) {
  return (
    <form action={setBrandAction} className="pref-switch">
      {back ? <input type="hidden" name="back" value={back} /> : <BackField />}
      <span className="muted small">{labels.preview}</span>
      <div className="segmented" role="group" aria-label={labels.preview}>
        <button name="brand" value="ems" aria-pressed={brand === 'ems'}>
          {labels.ems}
        </button>
        <button name="brand" value="kadr" aria-pressed={brand === 'kadr'}>
          {labels.kadrOption}
        </button>
      </div>
    </form>
  );
}
