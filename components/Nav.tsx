'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/chat', label: 'Coach', icon: '💬' },
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="h-16 border-b border-gray-800 bg-gray-950 flex items-center px-6 gap-8 flex-shrink-0">
      <Link href="/chat" className="flex items-center gap-2">
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
              <span>{icon}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
