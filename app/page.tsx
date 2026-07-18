import { redirect } from 'next/navigation';

// Redirect straight to /home — bouncing through /dashboard added an extra
// round trip on every app open.
export default function Home() {
  redirect('/home');
}
