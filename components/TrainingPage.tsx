'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SubTabBar from './SubTabBar';
import ProgressTab from './training/ProgressTab';
import TrainingPlanTab from './training/TrainingPlanTab';
import SideRail from '@/components/desktop/SideRail';

type Tab = 'progress' | 'plan';

export default function TrainingPage() {
  const sp = useSearchParams();
  const initial: Tab = sp.get('tab') === 'plan' ? 'plan' : 'progress';
  const [tab, setTab] = useState<Tab>(initial);

  const tabs = [
    { key: 'progress' as const, label: 'Progress'      },
    { key: 'plan'     as const, label: 'Training Plan' },
  ];

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Mobile: horizontal tab bar */}
      <div className="md:hidden">
        <SubTabBar tabs={tabs} active={tab} onSelect={setTab} />
      </div>

      {/* Desktop: left sidebar */}
      <SideRail tabs={tabs} active={tab} onSelect={setTab} />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4 pb-nav">
          {tab === 'progress' && <ProgressTab />}
          {tab === 'plan'     && <TrainingPlanTab />}
        </div>
      </div>
    </div>
  );
}
