import { redirect } from 'next/navigation';

/** /dashboard is legacy — redirect to /home (Feed). The old `?tab=`
 *  values map to the new top-level routes:
 *    feed       → /home
 *    activities → /activities
 *    progress   → /performance
 *    settings   → /settings
 */
export default async function LegacyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' ? sp.tab : 'feed';

  if (tab === 'activities') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k !== 'tab' && typeof v === 'string') qs.set(k, v);
    }
    redirect(`/activities${qs.toString() ? `?${qs.toString()}` : ''}`);
  }
  if (tab === 'progress')  redirect('/training?tab=progress');
  if (tab === 'settings')  redirect('/settings');
  redirect('/home');
}
