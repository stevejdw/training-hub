'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

const links = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/training',
    label: 'Training',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    href: '/fitness',
    label: 'Fitness',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    href: '/chat',
    label: 'Coach AI',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
];

const PersonIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const PROFILE_MENU = [
  {
    href: '/dashboard?tab=settings&settingsTab=profile',
    label: 'Profile',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    href: '/dashboard?tab=settings&settingsTab=plans',
    label: 'Training Plans',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/dashboard?tab=settings&settingsTab=events',
    label: 'Events & Goals',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
];

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
          open ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`}
        aria-label="Profile menu"
      >
        <PersonIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-full pt-1 w-52 z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1">
            {PROFILE_MENU.map(({ href, label, icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <span className="text-gray-500">{icon}</span>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();

  return (
    <>
      {/* ── Desktop: top horizontal nav ── */}
      <header className="hidden md:flex h-16 border-b border-gray-800 bg-gray-950 items-center px-6 gap-8 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-xl">🚴</span>
          <span className="font-semibold text-white tracking-tight">Training Hub</span>
        </Link>
        <nav className="flex gap-1">
          {links.map(({ href, label, icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {icon}
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <ProfileMenu />
        </div>
      </header>

      {/* ── Mobile: persistent top-right profile icon ── */}
      <div
        className="md:hidden fixed top-0 right-0 z-50 p-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <ProfileMenu />
      </div>

      {/* ── Mobile: fixed bottom tab bar ── */}
      {/*
        On iOS with viewportFit:cover, `bottom:0` lands at the safe-area
        boundary (~34px above the physical screen edge), leaving a gap.
        Pulling the nav down by safe-area-inset-bottom makes it extend to
        the physical edge, while padding-bottom pushes the icons back up
        into the visible zone.
      */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-800">
        <div className="flex h-14 pb-3">
          {links.map(({ href, label, icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-orange-500' : 'text-gray-500'
                }`}
              >
                {icon}
                <span className="text-[10px] font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
