import { DayRecord, History } from './history';
import { dayKey, parseDayKey, shiftDayKey } from './time';

export interface WeekDay {
  key: string;
  label: string;
  fullLabel: string;
  focusMs: number;
  sessions: number;
  active: boolean;
  isToday: boolean;
}

export interface Stats {
  todayFocusMs: number;
  totalSessions: number;
  weekFocusMs: number;
  goalPercent: number;
  goalMet: boolean;
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  week: WeekDay[];
  weekActiveDays: number;
  weekMaxMs: number;
}

const SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const isActive = (d: DayRecord | undefined): boolean => !!d && d.sessions > 0;

/** Length of the run of consecutive active days ending at `endKey`. */
function runEndingAt(days: Record<string, DayRecord>, endKey: string): number {
  let count = 0;
  let key = endKey;
  while (isActive(days[key])) {
    count += 1;
    key = shiftDayKey(key, -1);
  }
  return count;
}

export function computeStreaks(
  days: Record<string, DayRecord>,
  todayKey: string
): { current: number; longest: number; activeDays: number } {
  const activeKeys = Object.keys(days)
    .filter((k) => isActive(days[k]))
    .sort();

  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const key of activeKeys) {
    run = previous !== undefined && shiftDayKey(previous, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }

  // A streak is still alive if today has no session yet but yesterday did.
  const current = isActive(days[todayKey])
    ? runEndingAt(days, todayKey)
    : runEndingAt(days, shiftDayKey(todayKey, -1));

  return { current, longest, activeDays: activeKeys.length };
}

export function computeStats(history: History, now: number, goalMs: number): Stats {
  const todayKey = dayKey(now);
  const days = history.days;
  const today = days[todayKey]?.focusMs ?? 0;

  const week: WeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = shiftDayKey(todayKey, -i);
    const record = days[key];
    const dow = parseDayKey(key).getDay();
    week.push({
      key,
      label: SHORT[dow],
      fullLabel: FULL[dow],
      focusMs: record?.focusMs ?? 0,
      sessions: record?.sessions ?? 0,
      active: isActive(record),
      isToday: i === 0,
    });
  }

  const streaks = computeStreaks(days, todayKey);
  const goalPercent = goalMs > 0 ? Math.min(100, Math.round((today / goalMs) * 100)) : 0;

  return {
    todayFocusMs: today,
    totalSessions: history.totalSessions,
    weekFocusMs: week.reduce((sum, d) => sum + d.focusMs, 0),
    goalPercent,
    goalMet: goalMs > 0 && today >= goalMs,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    activeDays: streaks.activeDays,
    week,
    weekActiveDays: week.filter((d) => d.active).length,
    weekMaxMs: Math.max(goalMs, ...week.map((d) => d.focusMs), 1),
  };
}
