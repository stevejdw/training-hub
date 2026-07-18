'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ReferenceLine, Legend, Tooltip, ResponsiveContainer,
} from 'recharts';
import EnlargeableChart from '@/components/EnlargeableChart';

export interface FitnessPoint { date: string; atl: number; ctl: number; tsb: number }

export const FITNESS_RANGES = [
  { d: 30,  label: '30d' },
  { d: 90,  label: '90d' },
  { d: 180, label: '6m'  },
  { d: 365, label: '1y'  },
  { d: -1,  label: 'All' },
];

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** The CTL/ATL/TSB line chart, shared between FitnessTab (mobile/tablet)
 *  and the desktop dashboard. Pure props-driven: the caller owns the data
 *  fetch and the selected range. Downsamples long series to ~180 points. */
export default function FitnessChart({
  data,
  loading,
  days,
  setDays,
  height = 280,
}: {
  data: FitnessPoint[];
  loading: boolean;
  days: number;
  setDays: (d: number) => void;
  height?: number | '100%';
}) {
  const emptyClass = height === '100%' ? 'h-full' : 'h-64';

  if (loading) return <div className={`${emptyClass} animate-pulse bg-gray-800 rounded-lg`} />;
  if (data.length === 0) {
    return <div className={`${emptyClass} flex items-center justify-center text-gray-500 text-sm`}>No TSS data found</div>;
  }

  const chartData = data.length > 180
    ? data.filter((_, i) => i % Math.ceil(data.length / 180) === 0).concat(data[data.length - 1])
    : data;

  return (
    <EnlargeableChart className={height === '100%' ? 'h-full' : undefined} title="ATL · CTL · Form (TSB)" controls={
      <div className="flex gap-1 flex-wrap justify-end">
        {FITNESS_RANGES.map(({ d, label }) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              days === d
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    }>{(fs) => (
    <ResponsiveContainer width="100%" height={fs ? '100%' : height}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={fmtDate}
          tick={{ fill: '#6b7280', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6b7280', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFormatter={(s: any) => fmtDate(String(s))}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(val: any, name: any) => {
            const labels: Record<string, string> = { ctl: 'Fitness (CTL)', atl: 'Fatigue (ATL)', tsb: 'Form (TSB)' };
            const n = Number(val);
            return [n > 0 ? `+${n}` : n, labels[String(name)] ?? String(name)];
          }}
        />
        <Legend
          formatter={(value) => {
            const labels: Record<string, string> = { ctl: 'Fitness (CTL)', atl: 'Fatigue (ATL)', tsb: 'Form (TSB)' };
            return <span style={{ color: '#9ca3af', fontSize: 11 }}>{labels[value] ?? value}</span>;
          }}
        />
        <Line type="monotone" dataKey="ctl" stroke="#60a5fa" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="atl" stroke="#c084fc" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="tsb" stroke="#34d399" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
      </LineChart>
    </ResponsiveContainer>
    )}</EnlargeableChart>
  );
}
