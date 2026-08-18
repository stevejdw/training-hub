/** Chart colours, as CSS variable references.
 *
 *  Recharts renders SVG, and `stroke`/`fill` land as SVG presentation
 *  attributes — which are CSS properties, so `var()` resolves through the
 *  normal cascade from <html data-theme>. The object props work too:
 *  `tick={{ fill: CHART.axisText }}` is spread onto <text> as an attribute,
 *  and `contentStyle` is a React inline-style object where var() is ordinary
 *  CSS. So a theme switch stays a pure CSS cascade — no JS, no re-render, and
 *  no wrong colours on first paint.
 *
 *  Every value carries the previous hard-coded hex as its var() fallback, so a
 *  missing token degrades to the old appearance rather than to black.
 *
 *  Two things var() cannot do, and what to use instead:
 *   - Values read back into JS (string interpolation like `rgba(${hex},0.2)`).
 *     Use color-mix() or a dedicated token.
 *   - Per-datum conditional colour. Choose between var *names*, never resolve
 *     a hex: fill={tsb > 0 ? CHART.pos : CHART.neg}.
 */
export const CHART = {
  grid:          'var(--chart-grid, #1f2937)',
  axis:          'var(--chart-axis, #374151)',
  axisText:      'var(--chart-axis-text, #6b7280)',
  cursor:        'var(--chart-cursor, #4b5563)',
  tooltipBg:     'var(--chart-tooltip-bg, #1f2937)',
  tooltipBorder: 'var(--chart-tooltip-border, #374151)',
  tooltipText:   'var(--chart-tooltip-text, #f9fafb)',

  power:     'var(--chart-power, #f97316)',
  hr:        'var(--chart-hr, #60a5fa)',
  ef:        'var(--chart-ef, #f97316)',
  ctl:       'var(--chart-ctl, #60a5fa)',
  atl:       'var(--chart-atl, #c084fc)',
  compare:   'var(--chart-compare, #6b7280)',
  reference: 'var(--chart-reference, #9ca3af)',
  warn:      'var(--chart-warn, #fbbf24)',
  pos:       'var(--chart-pos, #34d399)',
  neg:       'var(--chart-neg, #f87171)',
  accent2:   'var(--chart-2, #60a5fa)',
} as const;

/** Shared axis/grid/cursor props. Replaces 34 copies of
 *  `tick={{ fill: '#6b7280', fontSize: 10 }}` and four spellings of cursor. */
export const gridProps = {
  stroke: CHART.grid,
  strokeDasharray: '3 3',
  vertical: false,
} as const;

export const xAxisProps = {
  tick: { fill: CHART.axisText, fontSize: 10 },
  tickLine: false,
  axisLine: { stroke: CHART.axis },
  minTickGap: 16,
} as const;

export const yAxisProps = {
  tick: { fill: CHART.axisText, fontSize: 10 },
  tickLine: false,
  axisLine: false,
  width: 44,
} as const;

export const cursorProps = {
  stroke: CHART.cursor,
  strokeWidth: 1,
} as const;

/** Tooltip chrome for Recharts' `contentStyle` / `labelStyle`. */
export const tooltipStyle = {
  background: CHART.tooltipBg,
  border: `1px solid ${CHART.tooltipBorder}`,
  borderRadius: 8,
  color: CHART.tooltipText,
} as const;
