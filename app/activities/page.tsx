import { redirect } from 'next/navigation';

export const metadata = { title: 'Activities | Training Hub' };

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set('tab', 'activities');
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
  }
  redirect(`/dashboard?${qs.toString()}`);
}
