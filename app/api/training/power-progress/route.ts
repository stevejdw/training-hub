import pool from '@/lib/db';
import { NextRequest } from 'next/server';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { ensureBestPowerTableForRead } from '@/lib/best-power';

export const runtime = 'nodejs';
export const maxDuration = 10;

const CYCLING_TYPES = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];

const DEFAULTS = [
  { seconds: 180,  label: '3 min'  },
  { seconds: 300,  label: '5 min'  },
  { seconds: 600,  label: '10 min' },
  { seconds: 1200, label: '20 min' },
  { seconds: 1800, label: '30 min' },
  { seconds: 3600, label: '60 min' },
];

function ftpMultiplier(seconds: number): number {
  if (seconds <= 30)   return 2.50;
  if (seconds <= 60)   return 1.80;
  if (seconds <= 180)  return 1.40;
  if (seconds <= 300)  return 1.30;
  if (seconds <= 600)  return 1.15;
  if (seconds <= 1200) return 1.05;
  if (seconds <= 1800) return 1.00;
  if (seconds <= 3600) return 0.92;
  return 0.85;
}

function secondsToLabel(s: number): string {
  if (s < 60) return `${s} sec`;
  const m = s / 60;
  if (Number.isInteger(m)) return `${m} min`;
  return `${m.toFixed(1)} min`;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#60a5fa', '#a78bfa', '#f472b6'];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days  = Math.min(99999, Math.max(1, parseInt(sp.get('days')  ?? '90', 10) || 90));
    const weeks = Math.min(99999, Math.max(1, parseInt(sp.get('weeks') ?? '26', 10) || 26));
    const durationsParam = sp.get('durations');

    // Fetch profile and verify table in parallel
    const [profile] = await Promise.all([
      getProfile(),
      ensureBestPowerTableForRead(),
    ]);

    const ftp     = effectiveFtp(profile);
    const tz      = profile.timezone || 'Australia/Sydney';

    const profileTargets = profile.power_targets ?? [];

    let durations: { seconds: number; label: string }[];
    if (durationsParam) {
      const parsed = durationsParam.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(s => Number.isInteger(s) && s > 0)
        .map(seconds => ({ seconds, label: secondsToLabel(seconds) }));
      const seen = new Set<number>();
      durations = parsed.filter(d => seen.has(d.seconds) ? false : (seen.add(d.seconds), true));
    } else {
      durations = profileTargets
        .slice()
        .sort((a, b) => a.seconds - b.seconds)
        .map(t => ({ seconds: t.seconds, label: t.label }));

      if (durations.length < 6) {
        const existing = new Set(durations.map(d => d.seconds));
        for (const def of DEFAULTS) {
          if (!existing.has(def.seconds)) {
            durations.push(def);
            if (durations.length === 6) break;
          }
        }
        durations.sort((a, b) => a.seconds - b.seconds);
      }
    }

    durations = durations.filter(d => Number.isInteger(d.seconds) && d.seconds > 0);

    if (durations.length === 0) {
      return Response.json({ weekly: [], current: {}, targets: [], ftp });
    }

    const secondsList = durations.map(d => d.seconds);

    // Run both aggregation queries in parallel (each uses pool.query for its own connection)
    const [weeklyRes, currentRes] = await Promise.all([
      pool.query(`
        SELECT
          date_trunc('week', (start_date AT TIME ZONE '${tz}'))::date::text AS week_start,
          seconds,
          MAX(best_watts) AS best_watts
        FROM best_power_efforts
        WHERE sport_type = ANY($1::text[])
          AND start_date >= NOW() - INTERVAL '${weeks} weeks'
          AND seconds = ANY($2::int[])
        GROUP BY week_start, seconds
        ORDER BY week_start, seconds
      `, [CYCLING_TYPES, secondsList]),
      pool.query(`
        SELECT seconds, MAX(best_watts) AS best_watts
        FROM best_power_efforts
        WHERE sport_type = ANY($1::text[])
          AND start_date >= NOW() - INTERVAL '${days} days'
          AND seconds = ANY($2::int[])
        GROUP BY seconds
        ORDER BY seconds
      `, [CYCLING_TYPES, secondsList]),
    ]);

    const weeklyMap = new Map<string, Record<string, number | string | null>>();
    for (const row of weeklyRes.rows) {
      const ws = row.week_start as string;
      const sec = Number(row.seconds);
      const watts = Number(row.best_watts);
      if (!weeklyMap.has(ws)) {
        const obj: Record<string, number | string | null> = { week_start: ws };
        for (const s of secondsList) obj[`d_${s}`] = null;
        weeklyMap.set(ws, obj);
      }
      weeklyMap.get(ws)![`d_${sec}`] = watts;
    }

    const current: Record<string, number | null> = {};
    for (const s of secondsList) current[`d_${s}`] = null;
    for (const row of currentRes.rows) {
      current[`d_${Number(row.seconds)}`] = Number(row.best_watts);
    }

    const targets = durations.map((d, i) => {
      const match = profileTargets.find(t => t.seconds === d.seconds);
      const targetWatts = match
        ? match.target_watts
        : Math.round(ftp * ftpMultiplier(d.seconds));
      return {
        key:          `d_${d.seconds}`,
        label:        d.label,
        seconds:      d.seconds,
        repeats:      match?.repeats ?? null,
        target_watts: targetWatts,
        color:        COLORS[i % COLORS.length],
        source:       match ? 'profile' as const : 'ftp' as const,
      };
    });

    return Response.json({
      weekly:  Array.from(weeklyMap.values()),
      current,
      targets,
      ftp,
    });
  } catch (err) {
    console.error('Power progress error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
