import { redirect } from 'next/navigation';

/** /fitness is legacy — fitness lives under Training now. */
export default function LegacyFitnessPage() {
  redirect('/training?tab=fitness');
}
