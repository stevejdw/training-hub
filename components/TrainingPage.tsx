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
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          {tab === 'progress' && <ProgressTab />}
          {tab === 'plan'     && <TrainingPlanTab />}
          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
