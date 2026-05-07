import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export const metadata = { title: 'Login | Training Hub' };

export default async function LoginPage() {
  // If already logged in, redirect to dashboard
  const session = await getSession();
  if (session) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold text-white">Training Hub</h1>
          <p className="text-sm text-gray-400 mt-2">
            Sign in with Strava to access your training analytics
          </p>
        </div>

        {/* Strava Connect Button */}
        <a
          href="/api/strava/auth"
          className="inline-flex items-center justify-center gap-3 w-full px-6 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 active:bg-orange-400 text-white font-semibold text-base transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Connect with Strava
        </a>

        <p className="text-xs text-gray-600">
          Requires a Strava account. Your activities, routes, and segments will be imported.
        </p>
      </div>
    </div>
  );
}
