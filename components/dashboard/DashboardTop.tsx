'use client';

import type { FeedData } from '@/components/FeedPage';
import TrainingStateStrip from './TrainingStateStrip';
import TodayHero from './TodayHero';
import EventCountdownBar from './EventCountdownBar';

/** The dashboard's opening hierarchy, shared by both layouts.
 *
 *  How am I → what am I doing today → what's coming.
 *
 *  Mobile and desktop import this one component precisely so the ordering
 *  can't drift again: the event used to be first on mobile and last on
 *  desktop, and the two layouts disagreed about the Form thresholds. */
export default function DashboardTop({ feed }: { feed?: FeedData | null }) {
  return (
    <div className="space-y-3">
      <TrainingStateStrip fitness={feed?.fitness} eftp={feed?.eftp} vo2max={feed?.vo2max} />
      <TodayHero session={feed?.nextSession} />
      <EventCountdownBar event={feed?.nextEvent} />
    </div>
  );
}
