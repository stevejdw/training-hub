import { Suspense } from 'react';
import ProgressTab from '@/components/training/ProgressTab';

export const metadata = { title: 'Training | Training Hub' };

/** Training is now just the Progress view. Plan management lives at
 *  /training-plans as its own top-level page. */
export default function TrainingPage() {
  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
        <Suspense>
          <ProgressTab />
        </Suspense>
        <div className="h-20" />
      </div>
    </div>
  );
}
