import { redirect } from 'next/navigation';

/** /fitness is legacy — fitness lives under Performance now. */
export default function LegacyFitnessPage() {
  redirect('/performance?tab=fitness');
}
