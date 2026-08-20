'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useAppIcon } from '@/components/ProfileProvider';
import SettingsGear from '@/components/SettingsGear';

export default function PageHeader({
  icon,
  title,
  right,
  back,
  showSettings = true,
}: {
  icon: ReactNode;
  title: string;
  right?: ReactNode;
  /** Replaces the (decorative) logo in the left slot with a real back
   *  control. Sub-screens get the affordance where a phone user reaches
   *  for it instead of a text link buried in the content. */
  back?: { label: string; onClick: () => void };
  /** Off only on headers whose right slot is a save action — navigating away
   *  mid-edit loses work. */
  showSettings?: boolean;
}) {
  const appIcon = useAppIcon();

  return (
    <div className="flex-shrink-0 relative flex items-center justify-center md:justify-start px-4 md:px-8 py-3 md:py-4 border-b border-line md:border-b-0 bg-page">
      {/* Back control, or the logo when there's nowhere to go back to.
          Mobile only — desktop uses the Nav header. */}
      <div className="absolute left-4 md:hidden">
        {back ? (
          <button
            onClick={back.onClick}
            aria-label={`Back to ${back.label}`}
            className="-ml-2 flex items-center justify-center w-10 h-10 rounded-lg text-ink-2 hover:text-ink hover:bg-raised transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <Image src={`/app-icon-${appIcon}.png`} alt="Training Hub" width={30} height={30} className="rounded-md" />
        )}
      </div>

      {/* Centred icon + title. Capped so the right cluster can't overlap it
          on a 375px screen. */}
      <div className="flex items-center gap-2.5 max-w-[calc(100%-9rem)]">
        {back && (
          <button
            onClick={back.onClick}
            aria-label={`Back to ${back.label}`}
            className="hidden md:flex items-center gap-1 -ml-2 pr-1 text-sm font-medium text-ink-3 hover:text-ink transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {back.label}
          </button>
        )}
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
