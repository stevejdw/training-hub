import { Suspense } from 'react';
import DashboardHome from '@/components/DashboardHome';

export const metadata = { title: 'Analytics | Training Hub' };

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardHome />
    </Suspense>
  );
}
