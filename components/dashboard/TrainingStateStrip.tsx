'use client';

import Link from 'next/link';
import { CHART } from '@/lib/chart-theme';
import { formBand } from './FormReading';

/** "How am I?" — the first thing the dashboard should answer.
 *
 *  Replaces the old FitnessSummary card, which sat fifth on mobile: 69% of the
 *  first screen went by before any training-state number appeared. Form leads
 *  because it is the number that changes what you do today; CTL and ATL are
 *  the supporting pair.
 *
 *  eFTP and VO₂max come down in the feed payload and were never displayed. */
export default function TrainingStateStrip({
  fitness,
  eftp,
  vo2max,
}: {
  fitness?: { ctl: number; atl: number; tsb: number };
  eftp?: number;
  vo2max?: number | null;
}) {
  if (!fitness) {
    return <div className="h-[78px] bg-raised rounded-2xl animate-pulse" />;
  }

  const band = formBand(fitness.tsb);

  return (
    <Link
      href="/training?tab=fitness"
      className="block bg-surface border border-line rounded-2xl px-4 py-3 hover:border-line-hover transition-colors"
    >
      <div className="flex items-center gap-4">
        {/* Form — dominant */}
        <div className="min-w-0 flex-1">
          <p className="text-micro text-ink-4 uppercase tracking-wider">Form</p>
          <p className="text-3xl font-black tabular-nums leading-none mt-0.5" style={{ color: band.color }}>
            {fitness.tsb > 0 ? '+' : ''}{fitness.tsb}
          </p>
          <p className="text-xs font-semibold mt-1" style={{ color: band.color }}>{band.label}</p>
          <p className="text-micro text-ink-4 mt-0.5 line-clamp-1">{band.hint}</p>
        </div>

        {/* Fitness / Fatigue — supporting */}
        <div className="flex-shrink-0 grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-micro text-ink-4 uppercase tracking-wider">CTL</p>
            <p className="text-xl font-bold tabular-nums leading-none mt-0.5" style={{ color: CHART.ctl }}>
              {fitness.ctl}
            </p>
            <p className="text-micro text-ink-4 mt-0.5">Fitness</p>
          </div>
          <div>
            <p className="text-micro text-ink-4 uppercase tracking-wider">ATL</p>
            <p className="text-xl font-bold tabular-nums leading-none mt-0.5" style={{ color: CHART.atl }}>
              {fitness.atl}
            </p>
            <p className="text-micro text-ink-4 mt-0.5">Fatigue</p>
          </div>
        </div>
      </div>

      {(eftp || vo2max != null) && (
        <p className="text-micro text-ink-5 mt-2 pt-2 border-t border-line/60">
          {eftp ? <>FTP <span className="text-ink-3 font-medium">{eftp} W</span></> : null}
          {eftp && vo2max != null ? ' · ' : null}
          {vo2max != null ? <>VO₂max <span className="text-ink-3 font-medium">{vo2max}</span></> : null}
        </p>
      )}
    </Link>
  );
}
