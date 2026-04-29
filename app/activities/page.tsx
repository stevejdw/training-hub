import { Suspense } from 'react';
import ActivitiesList from '@/components/ActivitiesList';

export const metadata = { title: 'Activities | Training Hub' };

export default function ActivitiesPage() {
  return (
    <Suspense>
      <ActivitiesList />
    </Suspense>
  );
}
