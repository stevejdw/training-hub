import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';

export async function GET() {
  const profile   = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();

  if (!athleteId || !apiKey) return Response.json({ error: 'No intervals.icu credentials' });

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const today = new Date().toISOString().split('T')[0];
  const month = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const url = `https://intervals.icu/api/v1/athlete/${athleteId}/activities?oldest=${month}&newest=${today}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const data = await res.json();

  const sample = Array.isArray(data) ? data.slice(0, 3) : data;
  const fields = Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : [];

  return Response.json({ status: res.status, count: Array.isArray(data) ? data.length : 0, fields, sample });
}
