import { Suspense } from 'react';
import FeedPage from '@/components/FeedPage';

export const metadata = { title: 'Home | Training Hub' };

export default function HomePage() {
  return (
    <div className="h-full">
      <Suspense>
        <FeedPage />
      </Suspense>
    </div>
  );
}
