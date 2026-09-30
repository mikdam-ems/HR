import type { Metadata } from 'next';
import { getBrand } from '@/brand';
import { getDict } from '@/i18n';
import './globals.css';

const FONTS = {
  ems: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&display=swap',
  kadr: 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&family=Noto+Kufi+Arabic:wght@700;800&display=swap',
} as const;

export async function generateMetadata(): Promise<Metadata> {
  if ((await getBrand()) === 'kadr') {
    return {
      title: 'Kadr',
      description: 'Timesheets, time off and month-end close for teams that work at client sites.',
      icons: { icon: '/brand/kadr-icon.svg', apple: '/brand/kadr-apple-touch-icon.png' },
    };
  }
  return {
    title: 'EMS People & Culture',
    description: 'Timesheets, time off and the org chart for EMS.',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ locale, dir }, brand] = await Promise.all([getDict(), getBrand()]);
  return (
    <html lang={locale} dir={dir} data-brand={brand}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS[brand]} />
      </head>
      <body>{children}</body>
    </html>
  );
}
