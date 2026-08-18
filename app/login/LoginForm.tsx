'use client';

import { useState } from 'react';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    // Absolute URL: inside the iOS shell a relative path resolves against the
    // WebView origin, which is capacitor://localhost whenever the remote page
    // failed to load and the local fallback is showing. The request then never
    // reaches Vercel and surfaces as an unexplained failure.
    const endpoint = new URL('/api/auth/login', window.location.origin).toString();

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ password }),
        credentials: 'same-origin',
      });
    } catch (err) {
      // Only a genuine transport failure lands here — reading the body is
      // deliberately kept out of this try so a non-JSON response can't be
      // misreported as "no connection".
      setError(`Can't reach the server (${window.location.origin}) — ${String(err)}`);
      setLoading(false);
      return;
    }

    try {
      if (res.ok) {
        window.location.href = '/dashboard';
        return;
      }
      const body = await res.text();
      let message = `Login failed (HTTP ${res.status})`;
      try {
        message = (JSON.parse(body) as { error?: string }).error ?? message;
      } catch {
        // Not JSON — surface the status rather than pretending it was a
        // network problem. An HTML body here means a redirect or error page.
        message = `Unexpected ${res.status} response from the server`;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm space-y-8 text-center">

        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold text-ink">Training Hub</h1>
          <p className="text-sm text-ink-3 mt-2">Enter your password to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              required
              className="w-full px-4 py-3 rounded-xl bg-raised border border-line-strong text-ink placeholder-ink-4 focus:outline-none focus:border-accent text-base"
            />
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full px-6 py-3.5 rounded-xl bg-accent hover:bg-accent active:bg-accent-hi disabled:opacity-50 text-ink font-semibold text-base transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
        </form>
      </div>
    </div>
  );
}
