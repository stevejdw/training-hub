import type { AppliedTheme } from '@/components/ThemeProvider';

/** The themes the app ships. Single source of truth.
 *
 *  Theme data used to live in three places that drifted: the CSS, the Settings
 *  picker's own hex table, and the preview page's third table. Settings and
 *  /theme-preview both read this now; the swatches are for the picker chips
 *  only — everything rendered inside the app reads the CSS variables. */
export interface ThemeDef {
  id:     AppliedTheme;
  label:  string;
  family: string;
  group:  'dark' | 'light';
  /** [page, card, accent] — picker chips only. Keep in step with globals.css. */
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: 'dark',        label: 'Dark',  family: 'Carbon', group: 'dark',  swatch: ['#030712', '#111827', '#f97316'] },
  { id: 'light',       label: 'Light', family: 'Carbon', group: 'light', swatch: ['#f8fafc', '#ffffff', '#ea580c'] },
  { id: 'ocean',       label: 'Dark',  family: 'Ocean',  group: 'dark',  swatch: ['#000d1a', '#00172e', '#0ea5e9'] },
  { id: 'ocean-light', label: 'Light', family: 'Ocean',  group: 'light', swatch: ['#f0f9ff', '#ffffff', '#0284c7'] },
  { id: 'sand-dark',   label: 'Dark',  family: 'Sand',   group: 'dark',  swatch: ['#1a100a', '#261510', '#38bdf8'] },
  { id: 'sand',        label: 'Light', family: 'Sand',   group: 'light', swatch: ['#f8f4ef', '#ffffff', '#0369a1'] },
];

export const THEME_FAMILIES = ['Carbon', 'Ocean', 'Sand'] as const;

export const THEME_IDS = THEMES.map(t => t.id);

export function isAppliedTheme(v: string): v is AppliedTheme {
  return (THEME_IDS as string[]).includes(v);
}
