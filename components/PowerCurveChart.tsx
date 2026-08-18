'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import EnlargeableChart from '@/components/EnlargeableChart';
import { CHART, gridProps, xAxisProps, yAxisProps } from '@/lib/chart-theme';

export interface DataPoint {
  label:    string;
  power:    number;
  /** Absent on older cached payloads; derived from the label if missing. */
  seconds?: number;
  source?:  'best' | 'np';
}

interface Props {
  data:          DataPoint[];
  compareData?:  DataPoint[] | null;
  compareLabel?: string;
  ftp:           number;
  weightKg?:     number | null;
  /** Name for the primary series in the legend. "Best" on the period widget,
   *  "This ride" on an activity page. */
  currentLabel?: string;
}

const LABEL_SECONDS: Record<string, number> = {
  '1s': 1, '5s': 5, '15s': 15, '30s': 30,
  '1m': 60, '2m': 120, '5m': 300, '10m': 600, '20m': 1200, '30m': 1800,
  '45m': 2700, '60m': 3600, '75m': 4500, '90m': 5400,
  '2h': 7200, '3h': 10800, '4h': 14400, '5h': 18000, '6h': 21600,
  '8h': 28800, '10h': 36000, '12h': 43200, '15h': 54000,
};

/** Ticks chosen so the log axis reads in familiar units rather than powers of
 *  ten. Anything beyond the data range is dropped by `visibleTicks`. */
const TICKS = [1, 5, 15, 60, 300, 1200, 3600, 10800, 18000, 54000];

function fmtDuration(s: number): string {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = s / 3600;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

function secondsOf(d: DataPoint): number {
  return d.seconds ?? LABEL_SECONDS[d.label] ?? 0;
}

interface Row {
  seconds:   number;
  best:      number | null;
  estimated: number | null;
  compare:   number | null;
  /** True at the 23 real durations; false at interpolated positions. */
  measured:  boolean;
}

/** Log-linear interpolation between the two bracketing measured points.
 *  Returns null outside the series' range so the line stops rather than
 *  extrapolating. */
function interp(pts: Array<{ x: number; y: number }>, x: number): number | null {
  if (pts.length === 0) return null;
  if (x <= pts[0].x) return x === pts[0].x ? pts[0].y : null;
  const last = pts[pts.length - 1];
  if (x >= last.x) return x === last.x ? last.y : null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b.x) {
      const t = (Math.log(x) - Math.log(a.x)) / (Math.log(b.x) - Math.log(a.x));
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

/** The curve is only 23 points, so a plain hover snaps between them. Sampling
 *  the interpolated curve at ~180 log-spaced positions makes the crosshair
 *  read a value at any duration, the way Strava's does, without the API
 *  returning more data. */
function buildRows(
  current: DataPoint[],
  compare?: DataPoint[] | null,
): { rows: Row[]; hasEstimated: boolean } {
  const cur = current
    .map(d => ({ x: secondsOf(d), y: d.power, src: d.source ?? 'best' }))
    .filter(d => d.x > 0 && Number.isFinite(d.y))
    .sort((a, b) => a.x - b.x);

  const cmp = (compare ?? [])
    .map(d => ({ x: secondsOf(d), y: d.power }))
    .filter(d => d.x > 0 && Number.isFinite(d.y))
    .sort((a, b) => a.x - b.x);

  if (cur.length === 0) return { rows: [], hasEstimated: false };

  // Where the measured series stops being a true maximum and becomes an
  // NP-derived estimate. Everything from here on is drawn dashed.
  const firstNp = cur.find(d => d.src === 'np')?.x ?? Infinity;
  const hasEstimated = Number.isFinite(firstNp);

  const min = cur[0].x;
  const max = cur[cur.length - 1].x;

  const sampleXs = new Set<number>(cur.map(d => d.x));
  for (const c of cmp) if (c.x >= min && c.x <= max) sampleXs.add(c.x);

  const STEPS = 180;
  const lgMin = Math.log(min), lgMax = Math.log(max);
  for (let i = 0; i <= STEPS; i++) {
    sampleXs.add(Math.exp(lgMin + ((lgMax - lgMin) * i) / STEPS));
  }

  const measuredXs = new Set(cur.map(d => d.x));
  const rows: Row[] = [...sampleXs]
    .sort((a, b) => a - b)
    .map(x => {
      const y = interp(cur, x);
      // Duplicate the boundary point into both series so they join visually
      // instead of leaving a gap where the estimate begins.
      const inBest = y != null && x <= firstNp;
      const inEst  = y != null && x >= firstNp;
      return {
        seconds:   x,
        best:      inBest ? y : null,
        estimated: inEst ? y : null,
        compare:   interp(cmp, x),
        measured:  measuredXs.has(x),
      };
    });

  return { rows, hasEstimated };
}

function PowerTooltip({
  active, payload, ftp, weightKg, compareLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  ftp: number;
  weightKg?: number | null;
  compareLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const watts = row.best ?? row.estimated;
  if (watts == null) return null;

  return (
    <div
      className="rounded-lg px-2.5 py-2 text-xs"
      style={{
        background: CHART.tooltipBg,
        border: `1px solid ${CHART.tooltipBorder}`,
        color: CHART.tooltipText,
      }}
    >
      <p className="font-semibold mb-1">{fmtDuration(row.seconds)}</p>
      <p style={{ color: CHART.power }}>
        {Math.round(watts)} W
        {weightKg ? <span className="opacity-70"> · {(watts / weightKg).toFixed(2)} W/kg</span> : null}
      </p>
      {row.compare != null && (
        <p style={{ color: CHART.compare }}>
          {Math.round(row.compare)} W
          <span className="opacity-70"> · {compareLabel ?? 'Compare'}</span>
        </p>
      )}
      {ftp > 0 && (
        <p className="opacity-60 mt-0.5">{Math.round((watts / ftp) * 100)}% of FTP</p>
      )}
      {row.estimated != null && row.best == null && (
        <p className="opacity-60 mt-0.5">estimated</p>
      )}
    </div>
  );
}

export default function PowerCurveChart({ data, compareData, compareLabel, ftp, weightKg, currentLabel = 'Best' }: Props) {
  const { rows, hasEstimated } = useMemo(
    () => buildRows(data ?? [], compareData),
    [data, compareData],
  );

  const hasCompare = Boolean(compareData && compareData.length > 0);

  const visibleTicks = useMemo(() => {
    if (rows.length === 0) return TICKS;
    const min = rows[0].seconds, max = rows[rows.length - 1].seconds;
    return TICKS.filter(t => t >= min && t <= max);
  }, [rows]);

  if (!data || data.length === 0) {
    return (
      <div className="bg-raised rounded-xl h-48 flex items-center justify-center text-ink-4 text-sm">
        No power data available
      </div>
    );
  }

  return (
    <div className="bg-raised rounded-xl p-4">
      <EnlargeableChart title="Power Curve">
        {fs => (
          <>
            <ResponsiveContainer width="100%" height={fs ? '100%' : 260}>
              <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pcFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={CHART.power} stopOpacity={0.20} />
                    <stop offset="100%" stopColor={CHART.power} stopOpacity={0} />
                  </linearGradient>
                </defs>

                {/* Horizontal only — the log x-axis already carries the reading
                    and vertical lines on a log scale read as noise. */}
                <CartesianGrid {...gridProps} />

                {/* Log time. The old categorical axis spaced 1s and 15h equally,
                    which is why the curve had the wrong shape. Domain min is
                    pinned to 1: 0 or 'dataMin' makes the log scale emit NaN. */}
                <XAxis
                  dataKey="seconds"
                  type="number"
                  scale="log"
                  domain={[1, 'dataMax']}
                  ticks={visibleTicks}
                  tickFormatter={fmtDuration}
                  {...xAxisProps}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={v => `${v}W`}
                  {...yAxisProps}
                  width={52}
                />

                <Tooltip
                  cursor={{ stroke: CHART.cursor, strokeWidth: 1 }}
                  content={<PowerTooltip ftp={ftp} weightKg={weightKg} compareLabel={compareLabel} />}
                />
                <Legend iconType="plainline" verticalAlign="top" height={22} wrapperStyle={{ fontSize: 11 }} />

                {/* Distinct from the series colour — these used to be the same
                    orange at different opacities. */}
                <ReferenceLine
                  y={ftp}
                  stroke={CHART.reference}
                  strokeDasharray="4 4"
                  label={{ value: `FTP ${ftp}W`, fill: CHART.reference, fontSize: 11, position: 'insideTopRight' }}
                />

                <Area
                  dataKey="best"
                  stroke="none"
                  fill="url(#pcFill)"
                  isAnimationActive={false}
                  legendType="none"
                  connectNulls
                />

                {hasCompare && (
                  <Line
                    dataKey="compare"
                    name={compareLabel ?? 'Compare'}
                    stroke={CHART.compare}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}

                {/* dot={false}: 23 filled dots at r=4 were the clutter. The
                    crosshair plus activeDot does the reading instead. */}
                <Line
                  dataKey="best"
                  name={currentLabel}
                  stroke={CHART.power}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: CHART.power }}
                  isAnimationActive={false}
                  connectNulls
                />

                {hasEstimated && (
                  <Line
                    dataKey="estimated"
                    name="Estimated"
                    stroke={CHART.power}
                    strokeOpacity={0.55}
                    strokeWidth={2}
                    strokeDasharray="2 3"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: CHART.power }}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {hasEstimated && !fs && (
              <p className="text-micro text-ink-4 mt-1.5">
                Dashed tail is estimated from normalised power, not a measured maximum.
              </p>
            )}
          </>
        )}
      </EnlargeableChart>
    </div>
  );
}
