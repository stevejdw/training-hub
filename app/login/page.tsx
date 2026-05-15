import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import LoginForm from './LoginForm';

export const metadata = { title: 'Login | Training Hub' };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/dashboard');

  // If a user account exists in the DB, show password login.
  // If not (first-time setup), show the Strava connect button.
  let hasUser = false;
  try {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT id FROM users LIMIT 1');
      hasUser = res.rows.length > 0;
    } finally {
      client.release();
    }
  } catch {
    // DB unavailable — default to showing Strava connect
  }

  return <LoginForm hasUser={hasUser} />;
}
