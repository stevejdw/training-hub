'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FitnessTab from './training/FitnessTab';
import PowerProgressChart from './training/PowerProgressChart';
import HRPerformanceTab from './training/HRPerformanceTab';

type Tab = 'summary' | 'performance' | 'hr';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'summary', label: 'Summary',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    key: 'performance', label: 'Performance',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    key: 'hr', label: 'HR Performance',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
];

export default function FitnessPage() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const initialTab: Tab = rawTab === 'performance' ? 'performance' : rawTab === 'hr' ? 'hr' : 'summary';
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="h-full flex flex-col md:flex-row">

      {/* Mobile tab bar */}
      <div className="md:hidden flex-shrink-0 flex border-b border-gray-800 overflow-x-auto">
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

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col flex-shrink-0 w-56 border-r border-gray-800 bg-gray-950/50 py-6 px-3 gap-1">
        <div className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Fitness
        </div>
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-orange-500/15 text-orange-400 border-l-2 border-orange-500 pl-[10px]'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-touch min-w-0">
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          {tab === 'summary'     && <FitnessTab />}
          {tab === 'performance' && <PowerProgressChart />}
          {tab === 'hr'          && <HRPerformanceTab />}
        </div>
      </div>

    </div>
  );
}
