'use client';

import { useState } from 'react';
import DashboardBestPower from '@/components/DashboardBestPower';
import PowerProgressChart from './PowerProgressChart';

type SubTab = 'best' | 'timeline';

export default function PowerTab() {
  const [sub, setSub] = useState<SubTab>('best');

  return (
    <div className="space-y-4">
      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {([
          { key: 'best' as const,     label: 'Best Efforts' },
          { key: 'timeline' as const, label: 'Timeline'     },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSub(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              sub === key
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'best'     && <DashboardBestPower />}
      {sub === 'timeline' && <PowerProgressChart />}
    </div>
  );
}
