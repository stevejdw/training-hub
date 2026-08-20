import { redirect } from 'next/navigation';

/** Performance merged into Training. Deep links from activity detail, the
 *  readiness widget and the dashboard strip still point here, so carry the
 *  query string across rather than dropping people on the default tab. */
export default async function LegacyPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  if (!qs.get('tab')) qs.set('tab', 'fitness');
  redirect(`/training?${qs.toString()}`);
}
