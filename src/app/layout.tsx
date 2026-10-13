import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';

// latin-ext a magyar ő és ű miatt — enélkül a böngésző más fontból pótolná őket.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Uszoda Tracker — szabad úszósávok Budapesten',
  description:
    'Nézd meg, melyik budapesti uszodában hány úszósáv szabad abban az időpontban, amikor úszni indulnál.',
  applicationName: 'Uszoda Tracker',
  keywords: ['uszoda', 'úszósáv', 'Budapest', 'úszás', 'medence', 'nyitvatartás'],
  openGraph: {
    title: 'Uszoda Tracker',
    description: 'Szabad úszósávok a közeli budapesti uszodákban.',
    locale: 'hu_HU',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3f3' },
    { media: '(prefers-color-scheme: dark)', color: '#041a22' },
  ],
};

// Nem a Next által generált `LayoutProps<'/'>` típust használjuk: az csak az
// első `next build` után áll elő, így a friss klón `tsc --noEmit`-je elhasalna rajta.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <a
          href="#talalatok"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-pool focus:px-4 focus:py-2 focus:font-semibold focus:text-pool-ink"
        >
          Ugrás a találatokhoz
        </a>
        {children}
      </body>
    </html>
  );
}
