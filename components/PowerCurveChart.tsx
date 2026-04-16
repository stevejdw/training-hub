'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

interface Props {
  data: { label: string; power: number }[];
  ftp: number;
}

export default function PowerCurveChart({ data, ftp }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl h-48 flex items-center justify-center text-gray-500 text-sm">
        No power data available
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
          </defs>
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
          />
          <Tooltip
            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
            itemStyle={{ color: '#f97316' }}
            formatter={(v) => [`${Math.round(Number(v))}W`, 'Best Power']}
          />
          <ReferenceLine
            y={ftp}
            stroke="#f97316"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{ value: `FTP ${ftp}W`, fill: '#f97316', fontSize: 11, position: 'right' }}
          />
          <Area
            type="monotone"
            dataKey="power"
            stroke="#f97316"
            strokeWidth={2}
            fill="url(#powerGradient)"
            dot={{ fill: '#f97316', r: 4 }}
            activeDot={{ r: 6, fill: '#f97316' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
