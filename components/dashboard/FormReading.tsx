/** Standard TSB bands. The dashboard showed a bare signed number with a colour
 *  and no indication of what to do about it. */
export interface FormBand {
  label: string;
  hint:  string;
  color: string;
}

export function formBand(tsb: number): FormBand {
  if (tsb > 25)  return { label: 'Detraining',   hint: 'Very fresh — fitness is slipping',      color: 'var(--chart-warn)' };
  if (tsb > 5)   return { label: 'Fresh',        hint: 'Good window for a hard session or race', color: 'var(--chart-pos)' };
  if (tsb >= -10) return { label: 'Neutral',      hint: 'Steady — productive training zone',      color: 'var(--chart-hr)' };
  if (tsb >= -30) return { label: 'Building',     hint: 'Carrying fatigue — normal in a block',   color: 'var(--chart-warn)' };
  return { label: 'Very fatigued', hint: 'Deep fatigue — consider easing off', color: 'var(--chart-neg)' };
}
