import { Suspense } from 'react';
import FeedPage from '@/components/FeedPage';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';

export const metadata = { title: 'Home | Training Hub' };

export default function HomePage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('home')} title="Home" />
      <div className="flex-1 min-h-0">
        <Suspense>
          <FeedPage />
        </Suspense>
      </div>
    </div>
  );
}
