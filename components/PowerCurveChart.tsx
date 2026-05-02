'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';

interface DataPoint {
  label: string;
  power: number;
}

interface Props {
  data: DataPoint[];
  compareData?: DataPoint[] | null;
  compareLabel?: string;
  ftp: number;
}

// Merge current + compare data by label so both lines share the same x-axis
function mergeData(current: DataPoint[], compare?: DataPoint[] | null) {
  const labels = Array.from(new Set([...current.map((d) => d.label), ...(compare?.map((d) => d.label) ?? [])]));
  const order = ['1s','5s','15s','30s','1m','2m','5m','10m','20m','30m','45m','60m','75m','90m','2h','3h+'];
  labels.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return labels.map((label) => ({
    label,
    current: current.find((d) => d.label === label)?.power ?? null,
    compare: compare?.find((d) => d.label === label)?.power ?? null,
  }));
}

export default function PowerCurveChart({ data, compareData, compareLabel, ftp }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl h-48 flex items-center justify-center text-gray-500 text-sm">
        No power data available
      </div>
    );
  }

  const merged = mergeData(data, compareData);
  const hasCompare = compareData && compareData.length > 0;

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={merged} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="label"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
            tickFormatter={(v) => `${v}W`}
            width={52}
          />
          <Tooltip
            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
            formatter={(value, name) => [
              value != null ? `${Math.round(Number(value))}W` : '—',
              name === 'current' ? 'Current' : (compareLabel ?? 'Compare'),
            ]}
          />
          {hasCompare && (
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(value) =>
                value === 'current' ? 'Current' : (compareLabel ?? 'Compare')
              }
            />
          )}
          <ReferenceLine
            y={ftp}
            stroke="#f97316"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
            label={{ value: `FTP ${ftp}W`, fill: '#f97316', fontSize: 11, position: 'insideTopRight' }}
          />
          {hasCompare && (
            <Line
              type="monotone"
              dataKey="compare"
              stroke="#6b7280"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ fill: '#6b7280', r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          )}
          <Line
            type="monotone"
            dataKey="current"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ fill: '#f97316', r: 4 }}
            activeDot={{ r: 6, fill: '#f97316' }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
