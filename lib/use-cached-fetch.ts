'use client';

import { useEffect, useState } from 'react';

/** Hook: fetches JSON from a URL and caches the parsed result in localStorage
 *  under a stable key. On mount renders the cached value immediately (so the
 *  screen is "persistent" — no skeleton flash), then revalidates in the
 *  background. The cache key should already encode any active filters so
 *  switching filters doesn't show stale data. */
export function useCachedFetch<T>(url: string, cacheKey: string) {
  const [data, setData] = useState<T | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = localStorage.getItem(cacheKey);
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return !localStorage.getItem(cacheKey);
    } catch {
      return true;
    }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(r => r.json())
      .then((d: T) => {
        if (cancelled) return;
        setData(d);
        try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch { /* full quota etc */ }
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [url, cacheKey]);

  return { data, loading, error };
}
