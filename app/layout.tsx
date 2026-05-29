import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';
import ThemeProvider from '@/components/ThemeProvider';
import { getProfile } from '@/lib/profile';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getProfile().catch(() => null);
  const icon = profile?.app_icon ?? 'speed';
  return {
    title: 'Training Hub',
    description: 'Cycling training analytics and coaching',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black',
      title: 'Training Hub',
    },
    icons: {
      apple: `/app-icon-${icon}.png`,
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#030712',
};

const geistFonts = `${geistSans.variable} ${geistMono.variable}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${geistFonts} antialiased`}>
      {/* Anti-flash: apply stored theme before first paint */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=localStorage.getItem('theme')||'dark';var valid={'dark':1,'light':1,'ocean':1,'ocean-light':1,'sand':1,'sand-dark':1,'cosmic':1,'forest':1,'ivory':1,'chrome':1};var t=p==='auto'?(new Date().getHours()>=7&&new Date().getHours()<19?'light':'dark'):(valid[p]?p:'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();` }} />
      </head>
      <body className="flex flex-col bg-gray-950 text-white">
        <ThemeProvider />
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
