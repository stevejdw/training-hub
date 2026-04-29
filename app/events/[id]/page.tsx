import { Suspense } from 'react';
import EventDetailPage from '@/components/pages/EventDetailPage';

export const metadata = { title: 'Event | Training Hub' };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <EventDetailPage eventId={id} />
    </Suspense>
  );
}
