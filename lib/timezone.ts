/**
 * Timezone utility functions.
 *
 * IMPORTANT: This file must NOT import from lib/profile.ts or lib/db.ts
 * because it is used by client components. Server-side code should call
 * getTimezone() from lib/profile.ts directly.
 */

/**
 * Get the current Monday (start of week) in the given timezone.
 * Returns YYYY-MM-DD string.
 */
export function currentMonday(tz: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const dateStr = parts.map(p => p.value).join(''); // YYYY-MM-DD
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMon);
  return d.toISOString().slice(0, 10);
}

/**
 * Add days to a YYYY-MM-DD date string (UTC-based).
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the Monday of the week containing the given date string (YYYY-MM-DD).
 */
export function mondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMon);
  return d.toISOString().slice(0, 10);
}

/**
 * Get today's date in the given timezone as YYYY-MM-DD.
 */
export function todayInTimezone(tz: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}
