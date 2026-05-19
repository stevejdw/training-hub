import Image from 'next/image';
import type { ReactNode } from 'react';

/** Consistent page header used at the top of every top-level screen.
 *  Renders an icon (orange) + title and a subtle bottom border. Sized so it
 *  looks the same on mobile and desktop. */
export default function PageHeader({
  icon,
  title,
  right,
}: {
  icon: ReactNode;
  title: string;
  /** Optional right-side actions (links/buttons). */
  right?: ReactNode;
}) {
  return (
    <div className="flex-shrink-0 relative flex items-center justify-center px-4 md:px-8 py-3 md:py-4 border-b border-gray-800 bg-gray-950">
      {/* Logo pinned left — mobile only (desktop uses Nav header) */}
      <div className="absolute left-4 md:hidden">
        <Image src="/logo.png" alt="Training Hub" width={30} height={30} className="rounded-md" />
      </div>

      {/* Centred icon + title */}
      <div className="flex items-center gap-2.5">
        <span className="text-orange-400 [&_svg]:w-6 [&_svg]:h-6 md:[&_svg]:w-7 md:[&_svg]:h-7 flex-shrink-0">
          {icon}
        </span>
        <h1 className="text-lg md:text-xl font-bold text-white tracking-tight truncate">
          {title}
        </h1>
      </div>
      {/* Right-side actions pinned to the right edge */}
      {right && (
        <div className="absolute right-4 md:right-8 flex items-center">
          {right}
        </div>
      )}
    </div>
  );
}
