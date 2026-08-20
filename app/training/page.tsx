import { Suspense } from 'react';
import TrainingPage from '@/components/TrainingPage';

export const metadata = { title: 'Training | Training Hub' };

export default function TrainingRoute() {
  return (
    /* No PageHeader: TrainingPage's own TabHeader is the entire header on
       mobile, and the desktop shell supplies its own. */
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <Suspense>
          <TrainingPage />
        </Suspense>
      </div>
    </div>
  );
}
