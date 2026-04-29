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
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error((d && (d as { error?: string }).error) || `HTTP ${r.status}`);
        return d as T;
      })
      .then((d: T) => {
        if (cancelled) return;
        setData(d);
        // Only cache successful responses — never persist error payloads,
        // otherwise a transient 500 sticks around forever in localStorage.
        try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch { /* full quota etc */ }
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        // Drop any previously-cached error payload so the next mount won't
        // try to render it (older versions did cache errors).
        try { localStorage.removeItem(cacheKey); } catch {}
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [url, cacheKey]);

  return { data, loading, error };
}
