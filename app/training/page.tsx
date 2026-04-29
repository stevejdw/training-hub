import { Suspense } from 'react';
import PageHeader from '@/components/PageHeader';
import TrainingPage from '@/components/TrainingPage';
import { iconFor } from '@/components/nav-items';

export const metadata = { title: 'Training | Training Hub' };

export default function TrainingRoute() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('training')} title="Training" />
      <div className="flex-1 min-h-0">
        <Suspense>
          <TrainingPage />
        </Suspense>
      </div>
    </div>
  );
}
