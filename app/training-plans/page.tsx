import { redirect } from 'next/navigation';

export const metadata = { title: 'Training Plans | Training Hub' };

export default function TrainingPlansPage() {
  redirect('/training?tab=plan');
}
