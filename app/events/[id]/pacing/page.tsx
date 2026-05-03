import { Suspense } from 'react';
import EventPacingPage from '@/components/pages/EventPacingPage';

export const metadata = { title: 'Key Climbs & Pacing | Training Hub' };

export default async function PacingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <EventPacingPage eventId={id} />
    </Suspense>
  );
}
