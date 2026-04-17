import { syncRecentActivities } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await syncRecentActivities();
    return Response.json(result);
  } catch (err) {
    console.error('Manual sync error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
