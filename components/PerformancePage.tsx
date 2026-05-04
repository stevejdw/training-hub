'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SubTabBar from './SubTabBar';
import FitnessTab from './training/FitnessTab';
import TssRollingChart from './training/TssRollingChart';
import AerobicEfficiencyTab from './training/AerobicEfficiencyTab';
import ReadinessTab from './training/ReadinessTab';
import KeyIntervalsTab from './training/KeyIntervalsTab';
import PowerCurveWidget from './training/PowerCurveWidget';
import DashboardBestPower from './DashboardBestPower';

type Tab = 'fitness' | 'power';

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {subtitle && <span className="text-[11px] text-gray-500">{subtitle}</span>}
    </div>
  );
}

export default function PerformancePage() {
  const sp = useSearchParams();
  const initialTab: Tab = sp.get('tab') === 'power' ? 'power' : 'fitness';
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="h-full flex flex-col">
      <SubTabBar
        tabs={[
          { key: 'fitness', label: 'Fitness' },
          { key: 'power',   label: 'Power'   },
        ]}
        active={tab}
        onSelect={setTab}
      />

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-8">
          {tab === 'fitness' && (
            <>
              {/* ── Fitness Performance ─────────────────────── */}
              <section>
                <SectionHeading title="Fitness Performance" subtitle="ATL · CTL · TSB" />
                <FitnessTab />
              </section>

              {/* ── Rolling Weekly TSS vs target ────────────── */}
              <section className="pt-2 border-t border-gray-800/60">
                <SectionHeading title="Weekly TSS" subtitle="Actual vs target per week" />
                <TssRollingChart />
              </section>

              {/* ── Aerobic Efficiency ──────────────────────── */}
              <section className="pt-2 border-t border-gray-800/60">
                <SectionHeading title="Aerobic Efficiency" subtitle="Power vs HR drift on steady rides" />
                <AerobicEfficiencyTab />
              </section>

              {/* ── Readiness ───────────────────────────────── */}
              <section className="pt-2 border-t border-gray-800/60">
                <SectionHeading title="Readiness" subtitle="HRV vs Normal Zone" />
                <ReadinessTab />
              </section>
            </>
          )}

          {tab === 'power' && (
            <>
              <section>
                <SectionHeading title="Key Intervals" />
                <KeyIntervalsTab />
              </section>
              <section className="pt-2 border-t border-gray-800/60">
                <SectionHeading title="Power Curve" subtitle="Best power by duration" />
                <PowerCurveWidget />
              </section>
              <section className="pt-2 border-t border-gray-800/60">
                <SectionHeading title="Best Efforts" />
                <DashboardBestPower />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
