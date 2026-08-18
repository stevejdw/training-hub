'use client';

import { useEffect, useState } from 'react';
import PowerCurveChart from '@/components/PowerCurveChart';
import { useCachedFetch } from '@/lib/use-cached-fetch';

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

import type { DataPoint } from '@/components/PowerCurveChart';
interface CurveResponse {
  curve1: DataPoint[];
  curve2: DataPoint[] | null;
  ftp: number;
  weightKg?: number | null;
}

export default function PowerCurveWidget() {
  const [p1, setP1] = useState<PeriodKey>('90d');
  const [p2, setP2] = useState<PeriodKey | 'none'>('none');
  const [comparing, setComparing] = useState(false);

  const effectiveP2 = comparing && p2 !== 'none' ? p2 : 'none';
  const url = `/api/power-curve?p1=${p1}&p2=${effectiveP2}`;
  const cacheKey = `cache-power-curve-${p1}-${effectiveP2}`;
  const { data, loading } = useCachedFetch<CurveResponse>(url, cacheKey, 30 * 60 * 1000);

  // When compare is toggled off, reset p2
  useEffect(() => {
    if (!comparing) setP2('none');
  }, [comparing]);

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Power Curve</p>
        <button
          onClick={() => setComparing(c => !c)}
          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
            comparing
              ? 'bg-blue-500/15 text-blue-400 border-blue-500/40 hover:bg-blue-500/20'
              : 'bg-raised text-ink-4 border-line-strong hover:text-ink-2'
          }`}
        >
          {comparing ? 'Remove compare' : '+ Compare'}
        </button>
      </div>

      {/* Period selectors */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {comparing && (
            <span className="text-micro text-accent-hi uppercase tracking-wider w-10 flex-shrink-0">Base</span>
          )}
          <div className="flex gap-1 flex-wrap">
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setP1(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  p1 === key
                    ? 'bg-accent/20 text-accent-hi border border-accent/50'
                    : 'bg-raised text-ink-4 hover:text-ink-2 border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {comparing && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-micro text-blue-400 uppercase tracking-wider w-10 flex-shrink-0">Vs</span>
            <div className="flex gap-1 flex-wrap">
              {PERIODS.filter(p => p.key !== p1).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setP2(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    p2 === key
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                      : 'bg-raised text-ink-4 hover:text-ink-2 border border-transparent'
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
        <div className="h-52 bg-raised/60 rounded-xl animate-pulse" />
      )}
      {!loading && data && (
        <PowerCurveChart
          data={data.curve1}
          compareData={data.curve2}
          compareLabel={comparing && p2 !== 'none' ? PERIOD_LABELS[p2] : undefined}
          ftp={data.ftp}
          weightKg={data.weightKg}
        />
      )}
      {!loading && !data && (
        <div className="h-52 flex items-center justify-center text-ink-5 text-sm">
          Failed to load power curve
        </div>
      )}
    </div>
  );
}
