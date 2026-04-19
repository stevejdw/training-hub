'use client';

import { useEffect } from 'react';

export type ThemePreference = 'dark' | 'light' | 'auto';

/** Resolve the actual theme to apply given the user's preference. */
export function resolveTheme(pref: ThemePreference): 'dark' | 'light' {
  if (pref === 'auto') {
    const h = new Date().getHours();
    return h >= 7 && h < 19 ? 'light' : 'dark';
  }
  return pref;
}

/** Apply a preference to the DOM immediately. */
export function applyTheme(pref: ThemePreference) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
}

/** Persist + apply a preference. */
export function setThemePreference(pref: ThemePreference) {
  localStorage.setItem('theme', pref);
  applyTheme(pref);
}

/** Read the stored preference (defaults to 'dark'). */
export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('theme') as ThemePreference) ?? 'dark';
}

/**
 * Mounts into the app once. Reads localStorage and applies theme.
 * Re-applies auto theme when the tab regains focus (time may have changed).
 */
export default function ThemeProvider() {
  useEffect(() => {
    const pref = getThemePreference();
    applyTheme(pref);

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        const p = getThemePreference();
        if (p === 'auto') applyTheme('auto');
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return null;
}
