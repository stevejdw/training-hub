import { Suspense } from 'react';
import PerformancePage from '@/components/PerformancePage';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';

export const metadata = { title: 'Performance | Training Hub' };

export default function Page() {
  return (
    <div className="h-full flex flex-col">
      <div className="md:hidden">
        <PageHeader icon={iconFor('performance')} title="Performance" />
      </div>
      <div className="flex-1 min-h-0">
        <Suspense>
          <PerformancePage />
        </Suspense>
      </div>
    </div>
  );
}
