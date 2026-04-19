import { Suspense } from 'react';
import FitnessPage from '@/components/FitnessPage';

export const metadata = { title: 'Fitness | Training Hub' };

export default function FitnessRoute() {
  return (
    <Suspense>
      <FitnessPage />
    </Suspense>
  );
}
