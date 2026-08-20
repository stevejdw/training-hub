'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TabHeader from './TabHeader';
import LazySection from './LazySection';
import FitnessTab from './training/FitnessTab';
import AerobicEfficiencyTab from './training/AerobicEfficiencyTab';
import ReadinessTab from './training/ReadinessTab';
import KeyIntervalsTab from './training/KeyIntervalsTab';
import PowerCurveWidget from './training/PowerCurveWidget';
import DashboardBestPower from './DashboardBestPower';
import ProgressTab from './training/ProgressTab';
import TrainingPlanTab from './training/TrainingPlanTab';
import SideRail from '@/components/desktop/SideRail';

/**
 * Training — fitness, power, progress and the plan, in one place.
 *
 * Performance and Training used to be two top-level tabs telling one story:
 * Performance held Fitness + Power, Training held Progress + Plan, and Home
 * led with Form/CTL/ATL and a WTD/MTD/YTD card drawn from both. Which of the
 * two a given chart lived under was a guess. They're one section now, and
 * /performance redirects here.
 */

type Tab = 'fitness' | 'power' | 'progress' | 'plan';

const TABS = [
  { key: 'fitness'  as const, label: 'Fitness'  },
  { key: 'power'    as const, label: 'Power'    },
  { key: 'progress' as const, label: 'Progress' },
  { key: 'plan'     as const, label: 'Plan'     },
];

const VALID = new Set(TABS.map(t => t.key));

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {subtitle && <span className="text-mini text-ink-4">{subtitle}</span>}
    </div>
  );
}

export default function TrainingPage() {
  const sp = useSearchParams();
  const requested = sp.get('tab');
  const sub = sp.get('sub');
  const [tab, setTab] = useState<Tab>(
    requested && VALID.has(requested as Tab) ? (requested as Tab) : 'fitness',
  );

  /* ?sub=readiness deep-links to the Readiness section. The <section> wrapper
     renders immediately (LazySection only defers its children), so it is a
     valid scroll target on mount. */
  useEffect(() => {
    if (tab !== 'fitness' || sub !== 'readiness') return;
    document.getElementById('readiness')?.scrollIntoView({ block: 'start' });
  }, [tab, sub]);

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Mobile: the whole header is this one row */}
      <div className="md:hidden">
        <TabHeader tabs={TABS} active={tab} onSelect={setTab} />
      </div>

      {/* Desktop: left sidebar */}
      <SideRail tabs={TABS} active={tab} onSelect={setTab} />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-8 pb-nav">
          {tab === 'fitness' && (
            <>
              {/* No heading on the first section: the active sub-tab above
                  already names it. Later sections still need their own. */}
              <section>
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

          {tab === 'progress' && <ProgressTab />}
          {tab === 'plan'     && <TrainingPlanTab />}
        </div>
      </div>
    </div>
  );
}
