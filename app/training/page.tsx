import { Suspense } from 'react';
import TrainingPlanner from '@/components/TrainingPlanner';

export const metadata = { title: 'Training | Training Hub' };

export default function TrainingPage() {
  return (
    <div className="h-full">
      <Suspense>
        <TrainingPlanner />
      </Suspense>
    </div>
  );
}
