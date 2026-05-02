'use client';

import { useEffect, useState, useCallback } from 'react';
import PowerCurveChart from '@/components/PowerCurveChart';

const PERIODS = [
  { key: '7d',  label: '7d'  },
  { key: '30d', label: '30d' },
  { key: '60d', label: '60d' },
  { key: '90d', label: '90d' },
  { key: '6m',  label: '6m'  },
  { key: '1y',  label: '1y'  },
  { key: 'all', label: 'All' },
] as const;

type PeriodKey = typeof PERIODS[number]['key'];

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  '60d': 'Last 60 days',
  '90d': 'Last 90 days',
  '6m':  'Last 6 months',
  '1y':  'Last year',
  'all': 'All time',
};

interface DataPoint { label: string; power: number; }
interface CurveResponse { curve1: DataPoint[]; curve2: DataPoint[] | null; ftp: number; }

export default function PowerCurveWidget() {
  const [p1, setP1] = useState<PeriodKey>('90d');
  const [p2, setP2] = useState<PeriodKey | 'none'>('none');
  const [comparing, setComparing] = useState(false);
  const [data, setData] = useState<CurveResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const url = `/api/power-curve?p1=${p1}&p2=${comparing && p2 !== 'none' ? p2 : 'none'}`;
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [p1, p2, comparing]);

  useEffect(() => { load(); }, [load]);

  // When compare is toggled off, reset p2
  useEffect(() => {
    if (!comparing) setP2('none');
  }, [comparing]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Power Curve</p>
        <button
          onClick={() => setComparing(c => !c)}
          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
            comparing
              ? 'bg-blue-500/15 text-blue-400 border-blue-500/40 hover:bg-blue-500/20'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
          }`}
        >
          {comparing ? 'Remove compare' : '+ Compare'}
        </button>
      </div>

      {/* Period selectors */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {comparing && (
            <span className="text-[10px] text-orange-400 uppercase tracking-wider w-10 flex-shrink-0">Base</span>
          )}
          <div className="flex gap-1 flex-wrap">
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setP1(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  p1 === key
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {comparing && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-blue-400 uppercase tracking-wider w-10 flex-shrink-0">Vs</span>
            <div className="flex gap-1 flex-wrap">
              {PERIODS.filter(p => p.key !== p1).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setP2(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    p2 === key
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      {loading && (
        <div className="h-52 bg-gray-800/60 rounded-xl animate-pulse" />
      )}
      {!loading && data && (
        <PowerCurveChart
          data={data.curve1}
          compareData={data.curve2}
          compareLabel={comparing && p2 !== 'none' ? PERIOD_LABELS[p2] : undefined}
          ftp={data.ftp}
        />
      )}
      {!loading && !data && (
        <div className="h-52 flex items-center justify-center text-gray-600 text-sm">
          Failed to load power curve
        </div>
      )}

      {/* Legend hint */}
      {!loading && data && comparing && p2 !== 'none' && (
        <p className="text-[10px] text-gray-600">
          <span className="text-orange-400">—</span> {PERIOD_LABELS[p1]} &nbsp;
          <span className="text-gray-500">- -</span> {PERIOD_LABELS[p2]}
        </p>
      )}
    </div>
  );
}
