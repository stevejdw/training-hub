'use client';

import { setThemePreference, type ThemePreference } from '@/components/ThemeProvider';

const themes: Array<{
  id: ThemePreference;
  name: string;
  desc: string;
  bg: string;
  card: string;
  cardSecondary: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
}> = [
  {
    id: 'dark',
    name: 'Carbon Dark',
    desc: 'The original — near-black + orange',
    bg: '#030712',
    card: '#111827',
    cardSecondary: '#1f2937',
    border: '#1f2937',
    textPrimary: '#f9fafb',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    accent: '#f97316',
    accentBg: 'rgba(249,115,22,0.15)',
    accentBorder: 'rgba(249,115,22,0.4)',
  },
  {
    id: 'light',
    name: 'Carbon Light',
    desc: 'Clean slate — off-white + orange',
    bg: '#f8fafc',
    card: '#ffffff',
    cardSecondary: '#f1f5f9',
    border: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    accent: '#f97316',
    accentBg: 'rgba(249,115,22,0.1)',
    accentBorder: 'rgba(249,115,22,0.35)',
  },
  {
    id: 'ocean-light',
    name: 'Ocean Light',
    desc: 'Sky blue — clean & airy',
    bg: '#f0f9ff',
    card: '#ffffff',
    cardSecondary: '#e0f2fe',
    border: '#bae6fd',
    textPrimary: '#0c4a6e',
    textSecondary: '#075985',
    textMuted: '#0369a1',
    accent: '#0ea5e9',
    accentBg: 'rgba(14,165,233,0.1)',
    accentBorder: 'rgba(14,165,233,0.35)',
  },
  {
    id: 'sand-dark',
    name: 'Sand Dark',
    desc: 'Dark warm brown — sky blue',
    bg: '#1a100a',
    card: '#261510',
    cardSecondary: '#3a200e',
    border: '#4d2d15',
    textPrimary: '#fdf0e0',
    textSecondary: '#d4a870',
    textMuted: '#b08060',
    accent: '#0ea5e9',
    accentBg: 'rgba(14,165,233,0.15)',
    accentBorder: 'rgba(14,165,233,0.4)',
  },
  {
    id: 'chrome',
    name: 'Chrome',
    desc: 'Cool blue-gray — amber glow',
    bg: '#080e1a',
    card: '#0f1827',
    cardSecondary: '#172237',
    border: '#1e2f48',
    textPrimary: '#dde8f0',
    textSecondary: '#7093b0',
    textMuted: '#4d7090',
    accent: '#f59e0b',
    accentBg: 'rgba(245,158,11,0.15)',
    accentBorder: 'rgba(245,158,11,0.4)',
  },
  {
    id: 'sand',
    name: 'Sand',
    desc: 'Warm linen — sky blue accent',
    bg: '#f8f4ef',
    card: '#ffffff',
    cardSecondary: '#f2ebe1',
    border: '#e6d8c8',
    textPrimary: '#2c1810',
    textSecondary: '#7d5a42',
    textMuted: '#9a7d65',
    accent: '#0369a1',
    accentBg: 'rgba(3,105,161,0.1)',
    accentBorder: 'rgba(3,105,161,0.35)',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    desc: 'Deep navy — sky blue accent',
    bg: '#000d1a',
    card: '#00172e',
    cardSecondary: '#002447',
    border: '#003a70',
    textPrimary: '#e0f2fe',
    textSecondary: '#7ec8e3',
    textMuted: '#4a9fd4',
    accent: '#0ea5e9',
    accentBg: 'rgba(14,165,233,0.15)',
    accentBorder: 'rgba(14,165,233,0.4)',
  },
  {
    id: 'cosmic',
    name: 'Cosmic',
    desc: 'Dark purple — violet accent',
    bg: '#0a0514',
    card: '#130a24',
    cardSecondary: '#1e1035',
    border: '#2d1a50',
    textPrimary: '#f3e8ff',
    textSecondary: '#a78bca',
    textMuted: '#7c4daa',
    accent: '#8b5cf6',
    accentBg: 'rgba(139,92,246,0.15)',
    accentBorder: 'rgba(139,92,246,0.4)',
  },
  {
    id: 'forest',
    name: 'Forest',
    desc: 'Dark green — emerald accent',
    bg: '#021007',
    card: '#041f0e',
    cardSecondary: '#063318',
    border: '#0a4d24',
    textPrimary: '#ecfdf5',
    textSecondary: '#6dc98c',
    textMuted: '#2d9b5a',
    accent: '#10b981',
    accentBg: 'rgba(16,185,129,0.15)',
    accentBorder: 'rgba(16,185,129,0.4)',
  },
  {
    id: 'ivory',
    name: 'Ivory',
    desc: 'Warm cream — amber accent',
    bg: '#fdf8f0',
    card: '#ffffff',
    cardSecondary: '#fef3dc',
    border: '#e8d5a3',
    textPrimary: '#1c1917',
    textSecondary: '#7c5c2e',
    textMuted: '#9a7b4b',
    accent: '#d97706',
    accentBg: 'rgba(217,119,6,0.12)',
    accentBorder: 'rgba(217,119,6,0.4)',
  },
];

function ThemeCard({ t }: { t: typeof themes[0] }) {
  return (
    <div
      style={{
        background: t.bg,
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${t.border}`,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Mini nav bar */}
      <div style={{ background: t.bg, borderBottom: `1px solid ${t.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
          {['Feed', 'Training', 'Fitness'].map((label, i) => (
            <div key={label} style={{
              padding: '4px 10px',
              borderRadius: 8,
              background: i === 0 ? t.accent : 'transparent',
              color: i === 0 ? '#fff' : t.textMuted,
              fontSize: 11,
              fontWeight: 600,
            }}>{label}</div>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Stat card */}
        <div style={{ background: t.card, borderRadius: 12, border: `1px solid ${t.border}`, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>This Week</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[['TSS', '342'], ['Hours', '6.2'], ['kJ', '4,820']].map(([label, val]) => (
              <div key={label} style={{ background: t.cardSecondary, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: t.textPrimary, marginTop: 2 }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity row */}
        <div style={{ background: t.card, borderRadius: 12, border: `1px solid ${t.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: t.accentBg, border: `1px solid ${t.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.accent} strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textPrimary }}>Morning Threshold Ride</div>
            <div style={{ fontSize: 10, color: t.textSecondary, marginTop: 1 }}>2h 15m · 287W avg · 78km</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.accent }}>142 TSS</div>
        </div>

        {/* Fitness metrics row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[['CTL', '68', '#60a5fa'], ['ATL', '82', '#c084fc'], ['Form', '-14', '#f87171']].map(([label, val, color]) => (
            <div key={label} style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.border}`, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Button */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: t.accent, color: '#fff', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>
            Generate Plan
          </div>
          <div style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: t.cardSecondary, border: `1px solid ${t.border}`, color: t.textSecondary, fontSize: 11, fontWeight: 600, textAlign: 'center' }}>
            View History
          </div>
        </div>

        {/* Text contrast sample */}
        <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textPrimary, marginBottom: 3 }}>Primary text — fully readable</div>
          <div style={{ fontSize: 11, color: t.textSecondary, marginBottom: 2 }}>Secondary text — labels and descriptions</div>
          <div style={{ fontSize: 10, color: t.textMuted }}>Muted text — tertiary info &amp; timestamps</div>
        </div>
      </div>

      {/* Footer: Apply button */}
      <div style={{ borderTop: `1px solid ${t.border}`, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary }}>{t.name}</div>
          <div style={{ fontSize: 10, color: t.textMuted, marginTop: 1 }}>{t.desc}</div>
        </div>
        <button
          onClick={() => {
            setThemePreference(t.id);
            window.location.href = '/settings';
          }}
          style={{
            padding: '7px 16px',
            borderRadius: 8,
            background: t.accent,
            color: '#fff',
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export default function ThemePreviewPage() {
  return (
    <div style={{ minHeight: '100%', overflowY: 'auto', padding: '24px 16px 48px', maxWidth: 960, margin: '0 auto' }}>
      <h1 className="text-2xl font-bold text-white mb-1">Theme Previews</h1>
      <p className="text-sm text-gray-400 mb-6">Each card shows the full colour profile. Hit Apply to switch — you&apos;ll be taken to Settings to confirm.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
        {themes.map(t => <ThemeCard key={t.id} t={t} />)}
      </div>
    </div>
  );
}
