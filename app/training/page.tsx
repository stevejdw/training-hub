import { Suspense } from 'react';
import TrainingPlanner from '@/components/TrainingPlanner';

export default function TrainingPage() {
  return (
    <Suspense>
      <TrainingPlanner />
    </Suspense>
  );
}
