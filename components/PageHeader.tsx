'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useAppIcon } from '@/components/ProfileProvider';

export default function PageHeader({
  icon,
  title,
  right,
}: {
  icon: ReactNode;
  title: string;
  right?: ReactNode;
}) {
  const appIcon = useAppIcon();

  return (
    <div className="flex-shrink-0 relative flex items-center justify-center md:justify-start px-4 md:px-8 py-3 md:py-4 border-b border-line md:border-b-0 bg-page">
      {/* Logo pinned left — mobile only (desktop uses Nav header) */}
      <div className="absolute left-4 md:hidden">
        <Image src={`/app-icon-${appIcon}.png`} alt="Training Hub" width={30} height={30} className="rounded-md" />
      </div>

      {/* Centred icon + title */}
      <div className="flex items-center gap-2.5">
        <span className="text-accent-hi [&_svg]:w-6 [&_svg]:h-6 md:[&_svg]:w-7 md:[&_svg]:h-7 flex-shrink-0">
          {icon}
        </span>
        <h1 className="text-lg md:text-xl font-bold text-ink tracking-tight truncate">
          {title}
        </h1>
      </div>
      {right && (
        <div className="absolute right-4 md:right-8 flex items-center">
          {right}
        </div>
      )}
    </div>
  );
}
