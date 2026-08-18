'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ResponsiveContainer,
} from 'recharts';
import { CHART } from '@/lib/chart-theme';

interface Streams {
  watts: number[] | null;        // full 1 Hz resolution, indexed by seconds
  hr: number[] | null;           // full 1 Hz resolution, indexed by seconds
  altitude_m: number[] | null;   // downsampled, aligned with time_s
  distance_km: number[] | null;  // downsampled, aligned with time_s
  latlng: [number, number][] | null; // downsampled, aligned with time_s
  time_s: number[] | null;       // downsampled sample times (seconds)
}

interface Row {
  t: number;
  dist: number | null;
  alt: number | null;
  watts: number | null;
  hr: number | null;
  lat: number | null;
  lng: number | null;
}

type XMode = 'time' | 'distance';

const MAX_RENDER_POINTS = 1500;

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

/** Average of a full-res stream over a small window centred on second t —
 *  smooths 1 Hz spikes without losing shape at chart resolution. */
function sampleAt(stream: number[] | null, t: number, halfWindow = 2): number | null {
  if (!stream || stream.length === 0) return null;
  let sum = 0, n = 0;
  for (let i = Math.max(0, t - halfWindow); i <= Math.min(stream.length - 1, t + halfWindow); i++) {
    const v = stream[i];
    if (v != null) { sum += v; n++; }
  }
  return n > 0 ? Math.round(sum / n) : null;
}

const AXIS_TICK = { fill: CHART.axisText, fontSize: 10 } as const;
const TOOLTIP_STYLE = { background: CHART.tooltipBg, border: '1px solid #374151', borderRadius: 8, fontSize: 12 } as const;

/** Stacked, cursor-synced power / HR / elevation charts with a brush
 *  overview for zooming. Rows are built by iterating time_s (the
 *  downsampled axis) and sampling the full-res watts/hr streams at each
 *  sample's second — the arrays must never be zipped by index. */
export default function StreamCharts({
  activityId,
  onHover,
}: {
  activityId: string;
  onHover?: (latlng: [number, number] | null) => void;
}) {
  const [streams, setStreams] = useState<Streams | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [xMode, setXMode] = useState<XMode>('time');
  const [window_, setWindow] = useState<[number, number] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const first = await fetch(`/api/activities/${activityId}/streams`).then(r => r.json());
        if (cancelled) return;
        if (first.streams?.time_s?.length) { setStreams(first.streams); setLoading(false); return; }

        // No streams stored yet — trigger the self-backfilling sync, then retry.
        await fetch(`/api/activities/${activityId}/sync-streams`, { method: 'POST' });
        if (cancelled) return;
        const second = await fetch(`/api/activities/${activityId}/streams`).then(r => r.json());
        if (cancelled) return;
        if (second.streams?.time_s?.length) setStreams(second.streams);
        else setFailed(true);
        setLoading(false);
      } catch {
        if (!cancelled) { setFailed(true); setLoading(false); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [activityId]);

  const rows: Row[] = useMemo(() => {
    if (!streams?.time_s) return [];
    const { time_s, watts, hr, altitude_m, distance_km, latlng } = streams;
    const step = Math.max(1, Math.ceil(time_s.length / MAX_RENDER_POINTS));
    const out: Row[] = [];
    for (let i = 0; i < time_s.length; i += step) {
      const t = time_s[i];
      out.push({
        t,
        dist: distance_km?.[i] ?? null,
        alt: altitude_m?.[i] ?? null,
        watts: sampleAt(watts, t),
        hr: sampleAt(hr, t),
        lat: latlng?.[i]?.[0] ?? null,
        lng: latlng?.[i]?.[1] ?? null,
      });
    }
    return out;
  }, [streams]);

  const windowed = window_ ? rows.slice(window_[0], window_[1] + 1) : rows;

  const hasWatts = rows.some(r => r.watts != null);
  const hasHr    = rows.some(r => r.hr != null);
  const hasAlt   = rows.some(r => r.alt != null);
  const hasDist  = rows.some(r => r.dist != null);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-36 animate-pulse bg-raised rounded-xl" />)}
      </div>
    );
  }

  if (failed || rows.length === 0 || (!hasWatts && !hasHr && !hasAlt)) {
    return (
      <div className="bg-raised/50 border border-line-strong border-dashed rounded-xl p-8 text-center">
        <p className="text-ink-4 text-sm">No stream data for this activity</p>
      </div>
    );
  }

  const xKey = xMode === 'distance' && hasDist ? 'dist' : 't';
  const fmtX = (v: number) => xKey === 'dist' ? `${Number(v).toFixed(1)} km` : fmtClock(Number(v));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMove = (state: any) => {
    if (!onHover) return;
    const idx = state?.activeTooltipIndex;
    if (idx == null || !windowed[idx]) { onHover(null); return; }
    const { lat, lng } = windowed[idx];
    onHover(lat != null && lng != null ? [lat, lng] : null);
  };

  const sharedChartProps = {
    data: windowed,
    syncId: 'workbench',
    margin: { top: 4, right: 8, left: 0, bottom: 0 },
    onMouseMove: handleMove,
    onMouseLeave: () => onHover?.(null),
  };

  function chartPanel(title: string, unit: string, children: React.ReactNode) {
    return (
      <div className="bg-surface rounded-xl border border-line p-3">
        <p className="text-micro font-semibold text-ink-4 uppercase tracking-wider mb-1">{title}{unit ? ` (${unit})` : ''}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* x-axis toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Streams</p>
        <div className="flex bg-raised rounded-lg p-0.5 gap-0.5">
          {(['time', 'distance'] as XMode[]).map(m => (
            <button
              key={m}
              onClick={() => setXMode(m)}
              disabled={m === 'distance' && !hasDist}
              className={`px-2 py-1 rounded-md text-micro font-medium transition-colors disabled:opacity-30 ${
                xMode === m ? 'bg-accent text-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {m === 'time' ? 'Time' : 'Distance'}
            </button>
          ))}
        </div>
      </div>

      {hasWatts && chartPanel('Power', 'W', (
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart {...sharedChartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={fmtX} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={60} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={[0, 'auto']} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={v => fmtX(Number(v))} formatter={(v) => [`${v} W`, 'Power']} isAnimationActive={false} />
            <Line type="monotone" dataKey="watts" stroke={CHART.power} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      ))}

      {hasHr && chartPanel('Heart rate', 'bpm', (
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart {...sharedChartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={fmtX} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={60} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={v => fmtX(Number(v))} formatter={(v) => [`${v} bpm`, 'HR']} isAnimationActive={false} />
            <Line type="monotone" dataKey="hr" stroke={CHART.neg} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      ))}

      {hasAlt && chartPanel('Elevation', 'm', (
        <ResponsiveContainer width="100%" height={110}>
          <ComposedChart {...sharedChartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={fmtX} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={60} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={v => fmtX(Number(v))} formatter={(v) => [`${v} m`, 'Elevation']} isAnimationActive={false} />
            <Area type="monotone" dataKey="alt" stroke={CHART.hr} strokeWidth={1.5} fill={CHART.hr} fillOpacity={0.15} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      ))}

      {/* Overview + zoom brush over the full ride */}
      <div className="bg-surface rounded-xl border border-line px-3 pt-2 pb-1">
        <div className="flex items-center justify-between mb-1">
          <p className="text-micro font-semibold text-ink-4 uppercase tracking-wider">Zoom</p>
          {window_ && (
            <button onClick={() => setWindow(null)} className="text-micro text-accent-hi hover:text-accent-hi transition-colors">
              Reset
            </button>
          )}
        </div>
        <ResponsiveContainer width="100%" height={56}>
          <ComposedChart data={rows} margin={{ top: 0, right: 8, left: 44, bottom: 0 }}>
            <XAxis dataKey={xKey} hide />
            <Brush
              dataKey={xKey}
              height={40}
              travellerWidth={8}
              stroke={CHART.power}
              fill={CHART.grid}
              tickFormatter={fmtX}
              onChange={(range) => {
                if (range?.startIndex != null && range?.endIndex != null) {
                  const isFull = range.startIndex === 0 && range.endIndex === rows.length - 1;
                  setWindow(isFull ? null : [range.startIndex, range.endIndex]);
                }
              }}
            >
              <ComposedChart data={rows}>
                <Area type="monotone" dataKey={hasAlt ? 'alt' : hasWatts ? 'watts' : 'hr'} stroke={CHART.cursor} fill={CHART.axis} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </Brush>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
