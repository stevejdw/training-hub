/** Calendar semantics for training/event countdowns (Sydney local dates). */
export const ATHLETE_CALENDAR_TIMEZONE = 'Australia/Sydney';

function calendarPartsInZone(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  let y = 0;
  let m = 0;
  let d = 0;
  for (const p of formatter.formatToParts(date)) {
    if (p.type === 'year') y = Number(p.value);
    if (p.type === 'month') m = Number(p.value);
    if (p.type === 'day') d = Number(p.value);
  }
  return { y, m, d };
}

/** Whole calendar days from today's date to `dateStr` (YYYY-MM-DD), both in `timeZone`. */
export function calendarDaysFromToday(dateStr: string, timeZone = ATHLETE_CALENDAR_TIMEZONE): number {
  const bits = dateStr.split('-').map(Number);
  const ey = bits[0];
  const em = bits[1];
  const ed = bits[2];
  if (!ey || !em || !ed || bits.length !== 3) return NaN;

  const { y: ty, m: tm, d: td } = calendarPartsInZone(new Date(), timeZone);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const eventUtc = Date.UTC(ey, em - 1, ed);
  return (eventUtc - todayUtc) / 86400000;
}
