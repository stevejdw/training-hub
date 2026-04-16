import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Training Hub',
  description: 'Cycling training analytics and coaching',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Training Hub',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',   // lets content extend under notch/dynamic island
  themeColor: '#030712',
};

const geistFonts = `${geistSans.variable} ${geistMono.variable}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistFonts} h-full antialiased`}>
      <body className="flex flex-col bg-gray-950 text-white" style={{ height: '100dvh' }}>
        {/* Top nav — desktop only */}
        <Nav />
        {/* Main content fills remaining space */}
        <main className="content-area flex-1 overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
