import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LoginForm from './LoginForm';

export const metadata = { title: 'Login | Training Hub' };

/**
 * Password login, unconditionally.
 *
 * This page used to query `users` and fall back to a "Connect with Strava"
 * button when the table looked empty — which also happened whenever that query
 * merely *threw* (a cold Neon connection was enough). The result was being
 * pushed into a Strava OAuth flow to log in to your own app.
 *
 * Strava is a data source, not an identity provider. It's connected from
 * Settings now, and nothing about signing in depends on it.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/dashboard');
  return <LoginForm />;
}
