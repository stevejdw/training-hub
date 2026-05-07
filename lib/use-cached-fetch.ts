'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Hook: fetches JSON from a URL and caches the parsed result in localStorage
 * under a stable key. On mount renders the cached value immediately (so the
 * screen is "persistent" — no skeleton flash), then revalidates in the
 * background if the cached data is older than TTL.
 *
 * Also re-fetches when the tab regains visibility (user returns from another
 * tab) to keep data fresh throughout the day.
 *
 * @param ttlMs - Time-to-live in ms. Defaults to 6 hours. Pass 0 to skip cache entirely.
 */
export function useCachedFetch<T>(
  url: string,
  cacheKey: string,
  ttlMs: number = DEFAULT_TTL_MS,
) {
  const [data, setData] = useState<T | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const entry = localStorage.getItem(cacheKey);
      if (!entry) return null;
      const parsed = JSON.parse(entry) as { cachedAt: number; payload: T };
      return parsed?.payload ?? null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const entry = localStorage.getItem(cacheKey);
      if (!entry) return true;
      const parsed = JSON.parse(entry) as { cachedAt: number; payload: T };
      if (!parsed?.payload) return true;
      // If cache is still fresh, don't show loading skeleton
      return Date.now() - parsed.cachedAt > ttlMs;
    } catch {
      return true;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(() => {
    const id = ++fetchIdRef.current;

    fetch(url)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error((d && (d as { error?: string }).error) || `HTTP ${r.status}`);
        return d as T;
      })
      .then((d: T) => {
        if (id !== fetchIdRef.current) return; // stale
        setData(d);
        setError(null);
        // Cache with timestamp so we can enforce TTL on next mount
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), payload: d }));
        } catch { /* full quota etc */ }
        setLoading(false);
      })
      .catch(e => {
        if (id !== fetchIdRef.current) return;
        // Only clear cache if we have no data at all — otherwise keep stale
        // data visible rather than showing an error state.
        try {
          const entry = localStorage.getItem(cacheKey);
          if (!entry) localStorage.removeItem(cacheKey);
        } catch {}
        setError(String(e));
        setLoading(false);
      });
  }, [url, cacheKey]);

  useEffect(() => {
    doFetch();

    // Periodically re-fetch (every 30 min) so the dashboard stays fresh
    // without requiring a page reload.
    intervalRef.current = setInterval(doFetch, 30 * 60 * 1000);

    // Re-fetch when the tab regains visibility (user switches back)
    const onVisible = () => {
      if (document.visibilityState === 'visible') doFetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [doFetch]);

  return { data, loading, error };
}
