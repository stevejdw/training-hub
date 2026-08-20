'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useAppIcon } from '@/components/ProfileProvider';
import SettingsGear from '@/components/SettingsGear';

export default function PageHeader({
  icon,
  title,
  right,
  showSettings = true,
}: {
  icon: ReactNode;
  title: string;
  right?: ReactNode;
  /** Off only on headers whose right slot is a save action — navigating away
   *  mid-edit loses work. */
  showSettings?: boolean;
}) {
  const appIcon = useAppIcon();

  return (
    <div className="flex-shrink-0 relative flex items-center justify-center md:justify-start px-4 md:px-8 py-3 md:py-4 border-b border-line md:border-b-0 bg-page">
      {/* Logo pinned left — mobile only (desktop uses Nav header) */}
      <div className="absolute left-4 md:hidden">
        <Image src={`/app-icon-${appIcon}.png`} alt="Training Hub" width={30} height={30} className="rounded-md" />
      </div>

      {/* Centred icon + title. Capped so the right cluster can't overlap it
          on a 375px screen. */}
      <div className="flex items-center gap-2.5 max-w-[calc(100%-9rem)]">
        <span className="text-accent-hi [&_svg]:w-6 [&_svg]:h-6 md:[&_svg]:w-7 md:[&_svg]:h-7 flex-shrink-0">
          {icon}
        </span>
        <h1 className="text-lg md:text-xl font-bold text-ink tracking-tight truncate">
          {title}
        </h1>
      </div>
      {/* The gear is appended after `right`, never replacing it — four pages
          already use that slot. */}
      <div className="absolute right-4 md:right-8 flex items-center gap-2">
        {right}
        {showSettings && <SettingsGear />}
      </div>
    </div>
  );
}
