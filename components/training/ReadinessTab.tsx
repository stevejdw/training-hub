'use client';

/**
 * Readiness — daily HRV vs personal "Normal Zone".
 *
 * Currently a placeholder. Once the Garmin wrapper is wired up:
 *   - X-axis: date (last 30 / 60 / 90 days)
 *   - Y-axis: HRV (ms)
 *   - Daily HRV plotted as dots
 *   - Shaded band = 7-day & 60-day rolling average ± 1σ ("Normal Zone")
 *   - Alert when HRV stays below the band for 3 consecutive days → "High Fatigue"
 */
export default function ReadinessTab() {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
      {/* Mock chart silhouette so the layout shows the intended shape */}
      <div className="relative h-40 w-full">
        <svg viewBox="0 0 400 160" className="w-full h-full" preserveAspectRatio="none">
          {/* Y-axis grid */}
          {[0, 1, 2, 3].map(i => (
            <line key={i} x1={0} y1={i * 40} x2={400} y2={i * 40}
              stroke="#1f2937" strokeWidth={0.5} strokeDasharray="3 3" />
          ))}
          {/* Normal zone band */}
          <rect x={0} y={50} width={400} height={50}
            fill="#34d399" fillOpacity={0.10} />
          <line x1={0} y1={75} x2={400} y2={75}
            stroke="#34d399" strokeOpacity={0.4} strokeDasharray="4 3" />
          {/* Dummy HRV dots */}
          {[15, 35, 55, 75, 95, 115, 135, 155, 175, 195, 215, 235, 255, 275, 295, 315, 335, 355, 375].map((x, i) => {
            const y = 75 + Math.sin(i * 0.7) * 18 + (Math.random() - 0.5) * 6;
            return <circle key={i} cx={x} cy={y} r={2.5} fill="#9ca3af" fillOpacity={0.45} />;
          })}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/60 rounded">
          <span className="px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700 text-[11px] font-medium text-gray-300">
            Coming soon
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-300 font-medium">Daily HRV vs Normal Zone</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Daily HRV plotted against your personal Normal Zone (7-day &amp; 60-day rolling average).
          A &ldquo;High Fatigue&rdquo; alert triggers when HRV drops below the zone for 3+ days in a row.
        </p>
        <p className="text-[11px] text-gray-600 leading-relaxed pt-1 border-t border-gray-800">
          Requires daily HRV, sleep, and resting HR from Garmin Connect. Building a Garmin wrapper to pull these — once it&apos;s live, this chart will populate automatically.
        </p>
      </div>
    </div>
  );
}
