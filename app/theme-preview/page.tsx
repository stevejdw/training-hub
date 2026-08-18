'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, Scatter, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { setThemePreference, getThemePreference, type ThemePreference } from '@/components/ThemeProvider';
import { THEMES } from '@/lib/theme-tokens';
import { CHART, gridProps, xAxisProps, yAxisProps, cursorProps } from '@/lib/chart-theme';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import SectionHeading from '@/components/ui/SectionHeading';
import ErrorState from '@/components/ui/ErrorState';
import SaveStatus from '@/components/ui/SaveStatus';
import Modal from '@/components/ui/Modal';

/* Regression harness for the design system.
 *
 * This page renders the real primitives and a real Recharts chart against the
 * live CSS variables — no local hex table. The old version kept its own copy
 * of every theme's colours, which is precisely how the three theme definitions
 * drifted apart in the first place. If something here looks wrong in a theme,
 * the theme is wrong. */

const SERIES = Array.from({ length: 40 }, (_, i) => ({
  x: i,
  ctl: 60 + Math.sin(i / 5) * 8 + i * 0.3,
  atl: 55 + Math.sin(i / 2.5) * 18 + i * 0.28,
  tsb: 6 + Math.cos(i / 3) * 10,
  dot: 55 + Math.sin(i / 3) * 14,
}));

const TOKENS: Array<[string, string]> = [
  ['--surface-page', 'page'],
  ['--surface-card', 'card'],
  ['--surface-raised', 'raised'],
  ['--border-subtle', 'line'],
  ['--border-default', 'line-strong'],
  ['--text-primary', 'ink'],
  ['--text-secondary', 'ink-2'],
  ['--text-muted', 'ink-3'],
  ['--text-faint', 'ink-4'],
  ['--accent', 'accent'],
  ['--chart-grid', 'chart-grid'],
  ['--chart-axis-text', 'chart-axis-text'],
];

export default function ThemePreviewPage() {
  const [active, setActive] = useState<ThemePreference>('dark');
  const [modalOpen, setModalOpen] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => { setActive(getThemePreference()); }, []);

  /* Read the tokens back so the swatch table always reflects the CSS, never a
     second copy of it. */
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const [v] of TOKENS) out[v] = cs.getPropertyValue(v).trim();
    setResolved(out);
  }, [active]);

  function pick(id: ThemePreference) {
    setThemePreference(id);
    setActive(id);
  }

  return (
    <div className="h-full overflow-y-auto scroll-touch bg-page">
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-8 space-y-6 pb-nav">
        <div>
          <h1 className="text-xl font-bold text-ink">Design system harness</h1>
          <p className="text-sm text-ink-3 mt-1">
            Every primitive and a live chart, drawn from CSS variables. Cycle the themes —
            anything unreadable here is unreadable in the app.
          </p>
        </div>

        {/* Theme switcher */}
        <Card title="Theme">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {THEMES.map(t => {
              const on = active === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => pick(t.id)}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 transition-colors text-left
                    ${on ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-ink-4'}`}
                >
                  <span className="flex gap-1 flex-shrink-0">
                    {t.swatch.map((c, i) => (
                      <span key={i} className="w-3.5 h-3.5 rounded border border-black/10" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-xs font-semibold ${on ? 'text-accent' : 'text-ink-2'}`}>
                      {t.family}
                    </span>
                    <span className="block text-micro text-ink-4">{t.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => pick('auto')}
            className={`mt-2 w-full px-3 py-2 rounded-xl border text-xs font-semibold transition-colors
              ${active === 'auto' ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-ink-2 hover:border-ink-4'}`}
          >
            Auto — Carbon light 07:00–19:00
          </button>
        </Card>

        {/* Resolved tokens */}
        <Card title="Resolved tokens">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TOKENS.map(([v, name]) => (
              <div key={v} className="flex items-center gap-2 min-w-0">
                <span
                  className="w-6 h-6 rounded border border-line-strong flex-shrink-0"
                  style={{ background: `var(${v})` }}
                />
                <span className="min-w-0">
                  <span className="block text-micro font-mono text-ink-2 truncate">{name}</span>
                  <span className="block text-micro font-mono text-ink-4 truncate">{resolved[v] || '—'}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Chart — the thing that used to stay dark under every light theme */}
        <Card title="Chart" controls={<span className="text-micro text-ink-4">reads --chart-* only</span>}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={SERIES} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="tpFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.power} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={CHART.power} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="x" {...xAxisProps} />
                <YAxis {...yAxisProps} />
                <Tooltip
                  cursor={cursorProps}
                  contentStyle={{
                    background: CHART.tooltipBg,
                    border: `1px solid ${CHART.tooltipBorder}`,
                    borderRadius: 8,
                    color: CHART.tooltipText,
                  }}
                  labelStyle={{ color: CHART.tooltipText, fontWeight: 600 }}
                />
                <Legend iconType="plainline" verticalAlign="top" height={22} wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={70} stroke={CHART.reference} strokeDasharray="4 4" />
                <Area dataKey="ctl" stroke="none" fill="url(#tpFill)" isAnimationActive={false} legendType="none" />
                <Line dataKey="ctl" name="Fitness" stroke={CHART.ctl} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="atl" name="Fatigue" stroke={CHART.atl} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="tsb" name="Form" stroke={CHART.pos} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                <Scatter dataKey="dot" name="Rides" fill={CHART.power} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Primitives */}
        <Card title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>Open modal</Button>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Type scale">
            <div className="space-y-1">
              <p className="text-base font-bold text-ink">Base bold — ink</p>
              <p className="text-sm text-ink-2">Small — ink-2, body copy</p>
              <p className="text-xs text-ink-3">Extra small — ink-3, labels</p>
              <p className="text-mini text-ink-4">Mini — ink-4, replaces text-[11px]</p>
              <p className="text-micro text-ink-4 uppercase tracking-wider">Micro — replaces text-[10px]</p>
              <p className="text-sm text-accent">Accent text</p>
            </div>
          </Card>

          <Card title="Surfaces &amp; states">
            <div className="space-y-2">
              <div className="rounded-lg bg-raised border border-line p-3 text-xs text-ink-2">raised on card</div>
              <div className="rounded-lg bg-accent-soft border border-accent/40 p-3 text-xs text-accent">accent-soft</div>
              <div className="flex items-center gap-3 pt-1">
                <SaveStatus saving />
                <SaveStatus saved />
                <SaveStatus error="boom" onRetry={() => {}} />
              </div>
            </div>
          </Card>
        </div>

        <Card title="Empty / error">
          <ErrorState message="Could not load this data." onRetry={() => {}} />
        </Card>

        <div>
          <SectionHeading title="Section heading" subtitle="With a subtitle line" />
        </div>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Native dialog modal"
          subtitle="Escape closes it, focus is trapped"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => setModalOpen(false)}>Confirm</Button>
            </>
          }
        >
          <p className="text-sm text-ink-2">
            Built on <code className="font-mono text-accent">&lt;dialog&gt;</code> + showModal(), so focus
            trapping, Escape and top-layer stacking come from the platform.
          </p>
        </Modal>
      </div>
    </div>
  );
}
