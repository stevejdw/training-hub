import { getStravaToken } from '@/lib/strava-sync';
import type { CachedRoute } from '@/lib/profile';

export const runtime = 'nodejs';

const STRAVA_API = 'https://www.strava.com/api/v3';
const MAX_POINTS = 500;  // downsample to this many points for storage + display

function downsample<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr;
  const step = arr.length / maxPts;
  return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Accept raw IDs or full URLs like https://www.strava.com/routes/12345678
  const routeId = id.replace(/\D/g, '');
  if (!routeId) return Response.json({ error: 'Invalid route ID' }, { status: 400 });

  try {
    const token = await getStravaToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [routeRes, streamsRes] = await Promise.all([
      fetch(`${STRAVA_API}/routes/${routeId}`, { headers }),
      fetch(`${STRAVA_API}/routes/${routeId}/streams`, { headers }),
    ]);

    if (!routeRes.ok) {
      const err = await routeRes.json().catch(() => ({}));
      return Response.json({ error: `Strava error: ${routeRes.status} — ${(err as { message?: string }).message ?? 'not found'}` }, { status: routeRes.status });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routeData = await routeRes.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamsData: any[] = streamsRes.ok ? await streamsRes.json() : [];

    // Extract streams
    const distStream: number[] = streamsData.find((s: { type: string }) => s.type === 'distance')?.data ?? [];
    const altStream:  number[] = streamsData.find((s: { type: string }) => s.type === 'altitude')?.data  ?? [];

    // Downsample and convert distance to km
    const distKm = downsample(distStream, MAX_POINTS).map((d: number) => Math.round(d / 10) / 100);
    const altM   = downsample(altStream,  MAX_POINTS).map((a: number) => Math.round(a * 10) / 10);

    const cached: CachedRoute = {
      id:                  String(routeData.id),
      name:                routeData.name ?? 'Unnamed route',
      distance_m:          routeData.distance ?? 0,
      elevation_gain:      routeData.elevation_gain ?? 0,
      stream_distance_km:  distKm,
      stream_altitude_m:   altM,
    };

    return Response.json(cached);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
