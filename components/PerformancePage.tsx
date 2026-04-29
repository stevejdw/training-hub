'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SubTabBar from './SubTabBar';
import FitnessTab from './training/FitnessTab';
import HRPerformanceTab from './training/HRPerformanceTab';
import KeyIntervalsTab from './training/KeyIntervalsTab';
import DashboardBestPower from './DashboardBestPower';

type Tab = 'fitness' | 'power';

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
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-6">
          {tab === 'fitness' && (
            <>
              <FitnessTab />
              <div className="pt-2 border-t border-gray-800/60">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">HR Performance</h2>
                <HRPerformanceTab />
              </div>
            </>
          )}

          {tab === 'power' && (
            <>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Key Intervals</h2>
                <KeyIntervalsTab />
              </div>
              <div className="pt-2 border-t border-gray-800/60">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Best Efforts</h2>
                <DashboardBestPower />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
