import { redirect } from 'next/navigation';

// Legacy route — go straight to /home (was previously a double hop via /dashboard).
export default function Feed() {
  redirect('/home');
}
