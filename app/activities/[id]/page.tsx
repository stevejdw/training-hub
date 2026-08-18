import ActivityDetail from '@/components/ActivityDetail';
import { getSyncSources } from '@/lib/sync-sources';

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Segment efforts are a Strava construct — Garmin has no equivalent, so with
  // Garmin as the primary source the tab could only ever be empty for new
  // rides. Resolved here rather than in the client so it costs no extra
  // request. Existing efforts stay in the database and reappear if the source
  // is switched back.
  const { primary } = await getSyncSources().catch(() => ({ primary: 'strava' as const }));
  return <ActivityDetail id={id} segmentsEnabled={primary === 'strava'} />;
}
