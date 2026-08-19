'use client';

import { useEffect } from 'react';

export type AppliedTheme = 'dark' | 'light' | 'ocean' | 'ocean-light' | 'sand' | 'sand-dark';
export type ThemePreference = AppliedTheme | 'auto';

/** Resolve the actual theme to apply given the user's preference. */
export function resolveTheme(pref: ThemePreference): AppliedTheme {
  if (pref === 'auto') {
    const h = new Date().getHours();
    return h >= 7 && h < 19 ? 'light' : 'dark';
  }
  return pref;
}

/** Apply a preference to the DOM immediately. */
export function applyTheme(pref: ThemePreference) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
  syncThemeColorMeta();
}

/** Mirror --background into <meta name="theme-color">.
 *
 *  One of the few places a CSS variable genuinely has to be resolved in JS:
 *  the meta tag takes a colour value, not a var() reference. Everything that
 *  renders inside the page reads the variables directly instead. */
export function syncThemeColorMeta() {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--background')
    .trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = bg;
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
