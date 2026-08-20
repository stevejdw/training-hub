'use client';

import { Suspense, useEffect, useState } from 'react';
import FeedPage from '@/components/FeedPage';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useLayoutMode } from '@/components/desktop/useIsDesktop';
import DesktopDashboard from '@/components/desktop/DesktopDashboard';
import DashboardSkeleton from '@/components/desktop/DashboardSkeleton';

/** Client switcher for /home: desktop dashboard at lg+, the feed below.
 *  Waits for mount before branching so the wrong tree (and its data
 *  fetches) never mounts during hydration. */
export default function HomeContent() {
  const mode = useLayoutMode();
  const isDesktop = mode !== 'mobile';
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* Was `return null`, which blanked the whole page until hydration. The
     skeleton matches the real grid so nothing shifts when data lands. */
  if (!mounted) return <DashboardSkeleton desktop={isDesktop} />;

  /* Tablet gets the real dashboard too. It previously fell through to
     FeedPage's `hidden md:grid` branch — a third layout to maintain, and
     since both FeedPage branches mounted below 1024px it fetched the
     coaching insight twice. */
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
