'use client';

import { Suspense, useEffect, useState } from 'react';
import FeedPage from '@/components/FeedPage';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useIsDesktop } from '@/components/desktop/useIsDesktop';
import DesktopDashboard from '@/components/desktop/DesktopDashboard';

/** Client switcher for /home: desktop dashboard at lg+, the feed below.
 *  Waits for mount before branching so the wrong tree (and its data
 *  fetches) never mounts during hydration. */
export default function HomeContent() {
  const isDesktop = useIsDesktop();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  if (isDesktop) return <DesktopDashboard />;

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('home')} title="Home" />
      <div className="flex-1 min-h-0">
        <Suspense>
          <FeedPage />
        </Suspense>
      </div>
    </div>
  );
}
