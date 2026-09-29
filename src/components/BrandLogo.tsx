import type { Brand } from '@/brand';
import { EmsLogo } from '@/components/EmsLogo';
import { KadrMark } from '@/components/KadrMark';

/** The logo and product name for the top bar and sign-in: EMS logo + name, or the Kadr mark + wordmark. */
export function BrandLogo({ brand, appName }: { brand: Brand; appName: string }) {
  if (brand === 'kadr') {
    return (
      <>
        <KadrMark />
        <span className="brand-name kadr-wordmark">{appName}</span>
      </>
    );
  }
  return (
    <>
      <EmsLogo />
      <span className="divider" aria-hidden="true" />
      <span className="brand-name">{appName}</span>
    </>
  );
}
