import { History } from './history';
import { breakMessage, dailyMessage } from './messages';
import { Settings } from './settings';
import { computeStats, Stats } from './stats';
import { SessionMode, TimerSnapshot } from './types';
import { dayKey, formatClock, formatDuration, MINUTE_MS } from './time';

export const MODE_LABELS: Record<SessionMode, string> = {
  focus: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

const STATUS_LABELS = { idle: 'Ready', running: 'Running', paused: 'Paused' } as const;

/** Plain-text bar, e.g. "[#####-----] 50%". ASCII only so it renders in any font. */
export function progressBar(percent: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${Math.round(percent)}%`;
}

export function formatStatus(timer: TimerSnapshot, settings: Settings, history: History, now: number): string {
  const stats = computeStats(history, now, settings.dailyGoalMinutes * MINUTE_MS);
  const lines = [
    `Timer: ${MODE_LABELS[timer.mode]} - ${STATUS_LABELS[timer.status]}`,
    `Time ${timer.status === 'idle' ? 'planned' : 'remaining'}: ${formatClock(timer.remainingMs)}`,
    `Cycle: ${timer.cycleDone} of ${timer.cycleLength} focus sessions before a long break`,
    `Today: ${formatDuration(stats.todayFocusMs)} of ${formatDuration(settings.dailyGoalMinutes * MINUTE_MS)}  ${progressBar(stats.goalPercent)}`,
  ];
  if (timer.endsAt !== null) {
    lines.splice(2, 0, `Ends at: ${new Date(timer.endsAt).toLocaleTimeString()}`);
  }
  const key = dayKey(now);
  lines.push('', timer.mode !== 'focus' && timer.status === 'running' ? breakMessage(key) : dailyMessage(key));
  return lines.join('\n');
}

export function formatStats(stats: Stats, goalMinutes: number): string {
  const goalMs = goalMinutes * MINUTE_MS;
  const rows = stats.week.map((d) => {
    const bar = '#'.repeat(Math.round((d.focusMs / stats.weekMaxMs) * 20)).padEnd(20, '.');
    const label = `${d.label} ${d.key.slice(5)}${d.isToday ? '*' : ' '}`;
    return `  ${label} ${bar} ${formatDuration(d.focusMs)}`;
  });
  return [
    `Today:             ${formatDuration(stats.todayFocusMs)} of ${formatDuration(goalMs)}  ${progressBar(stats.goalPercent)}`,
    `Daily goal:        ${stats.goalMet ? 'reached' : 'not yet reached'}`,
    `This week:         ${formatDuration(stats.weekFocusMs)} (${stats.weekActiveDays} active days)`,
    `Completed sessions: ${stats.totalSessions}`,
    `Current streak:    ${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'}`,
    `Longest streak:    ${stats.longestStreak} ${stats.longestStreak === 1 ? 'day' : 'days'}`,
    `Active days:       ${stats.activeDays}`,
    '',
    'Last 7 days (* = today):',
    ...rows,
  ].join('\n');
}
