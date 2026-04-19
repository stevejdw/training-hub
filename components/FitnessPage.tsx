'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FitnessTab from './training/FitnessTab';
import PowerProgressChart from './training/PowerProgressChart';
import HRPerformanceTab from './training/HRPerformanceTab';

type Tab = 'summary' | 'performance' | 'hr';

const TABS: { key: Tab; label: string }[] = [
  { key: 'summary',     label: 'Summary'        },
  { key: 'performance', label: 'Performance'    },
  { key: 'hr',          label: 'HR Performance' },
];

export default function FitnessPage() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const initialTab: Tab = rawTab === 'performance' ? 'performance' : rawTab === 'hr' ? 'hr' : 'summary';
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="h-full flex flex-col">

      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-800 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-orange-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {tab === 'summary'     && <FitnessTab />}
          {tab === 'performance' && <PowerProgressChart />}
          {tab === 'hr'          && <HRPerformanceTab />}
        </div>
      </div>

    </div>
  );
}
