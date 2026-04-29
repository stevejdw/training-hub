import { Suspense } from 'react';
import PerformancePage from '@/components/PerformancePage';

export const metadata = { title: 'Performance | Training Hub' };

export default function Page() {
  return (
    <Suspense>
      <PerformancePage />
    </Suspense>
  );
}
