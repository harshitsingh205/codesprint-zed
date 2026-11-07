export type SessionMode = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';

export const SESSION_MODES: readonly SessionMode[] = ['focus', 'shortBreak', 'longBreak'];
export const TIMER_STATUSES: readonly TimerStatus[] = ['idle', 'running', 'paused'];

/** Injectable clock so timer maths can be tested deterministically. */
export interface Clock {
  now(): number;
}
export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

export interface TimerDurations {
  focusMs: number;
  shortBreakMs: number;
  longBreakMs: number;
}

export interface EngineConfig {
  durations: TimerDurations;
  autoBreakSuggestions: boolean;
  sessionsBeforeLongBreak: number;
}

/**
 * Everything needed to rebuild the timer after a reload. Time is stored as
 * timestamps, never as a decrementing counter, so restoration is exact.
 */
export interface PersistedTimerState {
  mode: SessionMode;
  status: TimerStatus;
  /** Planned length of the current session. */
  durationMs: number;
  /** Time already consumed before the current running segment began. */
  elapsedMs: number;
  /** Epoch ms at which the current running segment started (running only). */
  segmentStartedAt: number | null;
  /** Epoch ms at which the session was first started. */
  sessionStartedAt: number | null;
  /** Completed focus sessions since the last long break. */
  focusSinceLongBreak: number;
}

/** A session that ran to completion. Incomplete sessions are never recorded. */
export interface CompletedSession {
  id: string;
  mode: SessionMode;
  plannedMs: number;
  startedAt: number;
  endedAt: number;
}

export interface Completion {
  session: CompletedSession;
  /** Mode the timer has been moved to (idle) after completion. */
  nextMode: SessionMode;
}

export interface TimerSnapshot {
  mode: SessionMode;
  status: TimerStatus;
  durationMs: number;
  remainingMs: number;
  endsAt: number | null;
  cycleDone: number;
  cycleLength: number;
}
