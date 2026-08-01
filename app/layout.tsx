import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';
import ThemeProvider from '@/components/ThemeProvider';
import NativeShell from '@/components/NativeShell';
import CommandPalette from '@/components/desktop/CommandPalette';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Training Hub',
  description: 'Cycling training analytics and coaching',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black',
    title: 'Training Hub',
  },
  // iOS/macOS "Add to Home Screen"/"Add to Dock" use the apple-touch-icon (they
  // ignore the web app manifest icons). Point it at a lightweight route that
  // resolves to the icon currently selected in Settings. Keeping the lookup in
  // its own route — rather than in this layout's metadata — lets the rest of
  // the app render statically instead of forcing a DB read on every page
  // navigation.
  icons: {
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#030712',
  // Required for correct hit-testing in the installed iOS PWA: without
  // viewport-fit=cover, landscape safe-area insets offset the rendered
  // content from the touch layer, making the whole app unresponsive in
  // landscape. With cover, content fills the screen and taps align.
  viewportFit: 'cover',
};

const geistFonts = `${geistSans.variable} ${geistMono.variable}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${geistFonts} antialiased`}>
      {/* Anti-flash: apply stored theme before first paint */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=localStorage.getItem('theme')||'dark';var valid={'dark':1,'light':1,'ocean':1,'ocean-light':1,'sand':1,'sand-dark':1,'cosmic':1,'forest':1,'ivory':1,'chrome':1};var t=p==='auto'?(new Date().getHours()>=7&&new Date().getHours()<19?'light':'dark'):(valid[p]?p:'dark');document.documentElement.setAttribute('data-theme',t);if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){document.documentElement.classList.add('native-app');}}catch(e){}})();` }} />
      </head>
      <body className="flex flex-col bg-gray-950 text-white">
        <ThemeProvider />
        <NativeShell />
        {/* Top nav — desktop only */}
        <Nav />
        {/* ⌘K command palette (desktop only) */}
        <CommandPalette />
        {/* Main content fills remaining space */}
        <main className="content-area flex-1 overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
