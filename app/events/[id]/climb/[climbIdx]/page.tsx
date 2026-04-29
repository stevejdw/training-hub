import { Suspense } from 'react';
import ClimbDetailPage from '@/components/pages/ClimbDetailPage';

export const metadata = { title: 'Climb | Training Hub' };

export default async function ClimbPage({
  params,
}: {
  params: Promise<{ id: string; climbIdx: string }>;
}) {
  const { id, climbIdx } = await params;
  return (
    <Suspense>
      <ClimbDetailPage eventId={id} climbIdx={parseInt(climbIdx, 10)} />
    </Suspense>
  );
}
