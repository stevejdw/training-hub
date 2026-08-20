import { Suspense } from 'react';
import ActivitiesList from '@/components/ActivitiesList';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';

export const metadata = { title: 'Activities | Training Hub' };

export default function ActivitiesPage() {
  return (
    <div className="h-full flex flex-col">
      {/* Mobile drops this row entirely: the bottom tab bar already says
          Activities, and the filter row below carries the gear. */}
      <div className="hidden md:block">
        <PageHeader icon={iconFor('activities')} title="Activities" />
      </div>
      <div className="flex-1 min-h-0">
        <Suspense>
          <ActivitiesList />
        </Suspense>
      </div>
    </div>
  );
}
