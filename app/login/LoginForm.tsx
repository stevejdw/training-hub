'use client';

import { useState } from 'react';

export default function LoginForm({ hasUser }: { hasUser: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Login failed');
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
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
            {hasUser ? 'Enter your password to continue' : 'Connect Strava to get started'}
          </p>
        </div>

        {hasUser ? (
          /* Password form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              required
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 text-base"
            />
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full px-6 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 active:bg-orange-400 disabled:opacity-50 text-white font-semibold text-base transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          /* First-time setup: no user in DB yet, must connect Strava */
          <div className="space-y-4">
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 text-left">
              <p className="text-xs text-gray-400 leading-relaxed">
                First-time setup: connect your Strava account to import your activities.
                After this you&apos;ll log in with a password instead.
              </p>
            </div>
            <a
              href="/api/strava/auth"
              className="inline-flex items-center justify-center gap-3 w-full px-6 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 active:bg-orange-400 text-white font-semibold text-base transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
              </svg>
              Connect with Strava
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
