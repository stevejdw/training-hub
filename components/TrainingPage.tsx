'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SubTabBar from './SubTabBar';
import ProgressTab from './training/ProgressTab';
import TrainingPlanTab from './training/TrainingPlanTab';

type Tab = 'progress' | 'plan';

export default function TrainingPage() {
  const sp = useSearchParams();
  const initial: Tab = sp.get('tab') === 'plan' ? 'plan' : 'progress';
  const [tab, setTab] = useState<Tab>(initial);

  return (
    <div className="h-full flex flex-col">
      <SubTabBar
        tabs={[
          { key: 'progress', label: 'Progress'      },
          { key: 'plan',     label: 'Training Plan' },
        ]}
        active={tab}
        onSelect={setTab}
      />

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          {tab === 'progress' && <ProgressTab />}
          {tab === 'plan'     && <TrainingPlanTab />}
          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
