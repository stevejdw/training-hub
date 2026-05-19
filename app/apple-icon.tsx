import { ImageResponse } from 'next/og';

export const size        = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#030712',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 100 76" width="148" height="148">
          {/* ── Deep-section rear wheel ── */}
          <circle cx="22" cy="58" r="17" fill="none" stroke="#d1d5db" strokeWidth="7" />
          <circle cx="22" cy="58" r="10" fill="#030712" />
          <circle cx="22" cy="58" r="2.5" fill="#6b7280" />

          {/* ── Deep-section front wheel ── */}
          <circle cx="78" cy="58" r="17" fill="none" stroke="#d1d5db" strokeWidth="7" />
          <circle cx="78" cy="58" r="10" fill="#030712" />
          <circle cx="78" cy="58" r="2.5" fill="#6b7280" />

          {/* ── Chain stays ── */}
          <line x1="22" y1="58" x2="50" y2="58" stroke="#e5e7eb" strokeWidth="4" strokeLinecap="round" />

          {/* ── Seat stays (rear triangle) ── */}
          <line x1="44" y1="26" x2="22" y2="58" stroke="#e5e7eb" strokeWidth="3.5" strokeLinecap="round" />

          {/* ── Seat tube — teal accent ── */}
          <line x1="50" y1="58" x2="44" y2="23" stroke="#06b6d4" strokeWidth="5.5" strokeLinecap="round" />

          {/* ── Down tube — very wide, key aero feature ── */}
          <line x1="50" y1="58" x2="76" y2="44" stroke="#f1f5f9" strokeWidth="11" strokeLinecap="round" />

          {/* ── Top tube ── */}
          <line x1="44" y1="26" x2="72" y2="30" stroke="#e5e7eb" strokeWidth="5" strokeLinecap="round" />

          {/* ── Head tube ── */}
          <line x1="72" y1="30" x2="76" y2="44" stroke="#e5e7eb" strokeWidth="6" strokeLinecap="round" />

          {/* ── Fork — teal accent ── */}
          <path d="M76,44 Q77,53 78,58" fill="none" stroke="#06b6d4" strokeWidth="5" strokeLinecap="round" />

          {/* ── Seat post + saddle ── */}
          <line x1="45" y1="23" x2="45" y2="18" stroke="#e5e7eb" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="37" y1="17" x2="52" y2="17" stroke="#e5e7eb" strokeWidth="3.5" strokeLinecap="round" />

          {/* ── Stem + aero bars ── */}
          <line x1="72" y1="30" x2="77" y2="21" stroke="#e5e7eb" strokeWidth="4" strokeLinecap="round" />
          <line x1="74" y1="21" x2="86" y2="22" stroke="#e5e7eb" strokeWidth="3.5" strokeLinecap="round" />

          {/* ── Bottom bracket ── */}
          <circle cx="50" cy="58" r="3.5" fill="#e5e7eb" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
