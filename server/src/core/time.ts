/** Small, dependency-free date and duration helpers (local time). */

export const MINUTE_MS = 60_000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar day key, e.g. "2026-11-04". */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses a day key to a Date at local noon (immune to DST edge cases). */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return dayKey(parseDayKey(value).getTime()) === value;
}

export function shiftDayKey(key: string, deltaDays: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + deltaDays);
  return dayKey(d.getTime());
}

/** mm:ss countdown text. Rounds up so a fresh 25 minute session reads 25:00. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Compact duration such as "1h 15m", "45m" or "2h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) {
    return `${h}h ${m}m`;
  }
  return h > 0 ? `${h}h` : `${m}m`;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) {
    return 'Good morning';
  }
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}
