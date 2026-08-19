'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SubTabBar from './SubTabBar';
import LazySection from './LazySection';
import FitnessTab from './training/FitnessTab';
import AerobicEfficiencyTab from './training/AerobicEfficiencyTab';
import ReadinessTab from './training/ReadinessTab';
import KeyIntervalsTab from './training/KeyIntervalsTab';
import PowerCurveWidget from './training/PowerCurveWidget';
import DashboardBestPower from './DashboardBestPower';

type Tab = 'fitness' | 'power';

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {subtitle && <span className="text-mini text-ink-4">{subtitle}</span>}
    </div>
  );
}

export default function PerformancePage() {
  const sp = useSearchParams();
  const initialTab: Tab = sp.get('tab') === 'power' ? 'power' : 'fitness';
  const sub = sp.get('sub');
  const [tab, setTab] = useState<Tab>(initialTab);

  /* ?sub=readiness deep-links to the Readiness section. The <section> wrapper
     renders immediately (LazySection only defers its children), so it is a
     valid scroll target on mount. */
  useEffect(() => {
    if (tab !== 'fitness' || sub !== 'readiness') return;
    document.getElementById('readiness')?.scrollIntoView({ block: 'start' });
  }, [tab, sub]);

  const tabs = [
    { key: 'fitness' as const, label: 'Fitness' },
    { key: 'power'   as const, label: 'Power'   },
  ];

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Mobile: horizontal tab bar */}
      <div className="md:hidden">
        <SubTabBar tabs={tabs} active={tab} onSelect={setTab} />
      </div>

      {/* Desktop: left sidebar */}
      <nav className="hidden md:flex flex-col w-44 border-r border-line py-6 px-3 flex-shrink-0 gap-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-accent text-ink'
                : 'text-ink-3 hover:text-ink hover:bg-raised'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-8">
          {tab === 'fitness' && (
            <>
              <section>
                <SectionHeading title="Fitness Performance" subtitle="ATL · CTL · TSB" />
                <FitnessTab />
              </section>
              <section className="pt-2 border-t border-line/60">
                <SectionHeading title="Aerobic Efficiency" subtitle="Power vs HR drift on steady rides" />
                <LazySection>
                  <AerobicEfficiencyTab />
                </LazySection>
              </section>
              <section id="readiness" className="pt-2 border-t border-line/60">
                <SectionHeading title="Readiness" subtitle="HRV vs Normal Zone" />
                <LazySection>
                  <ReadinessTab />
                </LazySection>
              </section>
            </>
          )}

          {tab === 'power' && (
            <>
              <section>
                <SectionHeading title="Key Intervals" />
                <KeyIntervalsTab />
              </section>
              <section className="pt-2 border-t border-line/60">
                <SectionHeading title="Power Curve" subtitle="Best power by duration" />
                <LazySection>
                  <PowerCurveWidget />
                </LazySection>
              </section>
              <section className="pt-2 border-t border-line/60">
                <SectionHeading title="Best Efforts" />
                <LazySection>
                  <DashboardBestPower />
                </LazySection>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
