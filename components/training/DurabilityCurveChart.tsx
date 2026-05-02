'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
  Cell,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';

interface Ride {
  moving_time: number;  // seconds
  decoupling:  number;  // %
}

const BUCKETS = [
  { label: '< 1h',  min: 0,     max: 3600      },
  { label: '1–2h',  min: 3600,  max: 7200      },
  { label: '2–3h',  min: 7200,  max: 10800     },
  { label: '> 3h',  min: 10800, max: Infinity  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DurabilityTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { label: string; avg: number | null; count: number };
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="text-gray-300 font-medium">{d.label}</p>
      <p className="text-blue-400 font-semibold">
        {d.avg !== null ? `${d.avg.toFixed(1)}% avg decoupling` : 'No data'}
      </p>
      <p className="text-gray-500">{d.count} ride{d.count !== 1 ? 's' : ''}</p>
    </div>
  );
}

export default function DurabilityCurveChart() {
  const { data, loading, error } = useCachedFetch<{ rides: Ride[] }>(
    '/api/analytics/aerobic-efficiency?range=90d',
    'cache-durability-90d',
  );

  const rides = data?.rides ?? [];

  const bucketData = BUCKETS.map(b => {
    const matching = rides.filter(r => r.moving_time >= b.min && r.moving_time < b.max);
    const avg = matching.length
      ? Math.round((matching.reduce((s, r) => s + r.decoupling, 0) / matching.length) * 10) / 10
      : null;
    return { label: b.label, avg, count: matching.length };
  });

  const firstExceeds = bucketData.find(b => b.avg !== null && b.avg > 5);
  const contextLabel = firstExceeds
    ? `Decoupling typically exceeds 5% on rides over ${firstExceeds.label}`
    : bucketData.some(b => b.avg !== null)
      ? 'Aerobic base holds within all duration ranges (last 90 days)'
      : null;

  const hasData = bucketData.some(b => b.count > 0);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Durability Curve</p>
        <p className="text-[11px] text-gray-600 mt-0.5">
          Avg aerobic decoupling by ride duration — last 90 days
        </p>
      </div>

      {error ? (
        <div className="h-44 flex items-center justify-center text-red-400 text-sm">{error}</div>
      ) : loading && !hasData ? (
        <div className="h-44 animate-pulse bg-gray-800 rounded-lg" />
      ) : !hasData ? (
        <div className="h-44 flex items-center justify-center text-gray-500 text-sm text-center px-4">
          No steady rides with power + HR in the last 90 days
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={bucketData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={v => `${v}%`}
                domain={[0, 'auto']}
              />
              <Tooltip content={<DurabilityTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <ReferenceLine
                y={5}
                stroke="#f59e0b"
                strokeDasharray="5 4"
                label={{ value: '5%', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={60}>
                {bucketData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.avg === null ? '#374151' : entry.avg > 5 ? '#f87171' : entry.avg > 3 ? '#facc15' : '#60a5fa'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {contextLabel && (
            <p className={`text-[11px] font-medium ${firstExceeds ? 'text-yellow-400' : 'text-green-400'}`}>
              {contextLabel}
            </p>
          )}

          <p className="text-[10px] text-gray-600 leading-relaxed">
            <span className="text-blue-400">■</span> &lt; 3% ·
            <span className="text-yellow-400 ml-1.5">■</span> 3–5% ·
            <span className="text-red-400 ml-1.5">■</span> &gt; 5% ·
            <span className="text-amber-500 ml-1.5">- -</span> 5% target
          </p>
        </>
      )}
    </div>
  );
}
