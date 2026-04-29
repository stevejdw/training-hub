import { Suspense } from 'react';
import PageHeader from '@/components/PageHeader';
import ProgressTab from '@/components/training/ProgressTab';
import { iconFor } from '@/components/nav-items';

export const metadata = { title: 'Training | Training Hub' };

export default function TrainingPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('training')} title="Training" />
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          <Suspense>
            <ProgressTab />
          </Suspense>
          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
