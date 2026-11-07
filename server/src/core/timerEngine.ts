import {
  Clock,
  Completion,
  EngineConfig,
  PersistedTimerState,
  SessionMode,
  TimerDurations,
  TimerSnapshot,
  TimerStatus,
} from './types';

export const MIN_DURATION_MS = 1_000;
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export function durationFor(mode: SessionMode, d: TimerDurations): number {
  switch (mode) {
    case 'focus':
      return d.focusMs;
    case 'shortBreak':
      return d.shortBreakMs;
    case 'longBreak':
      return d.longBreakMs;
  }
}

export function createIdleState(
  mode: SessionMode,
  config: EngineConfig,
  focusSinceLongBreak = 0
): PersistedTimerState {
  return {
    mode,
    status: 'idle',
    durationMs: durationFor(mode, config.durations),
    elapsedMs: 0,
    segmentStartedAt: null,
    sessionStartedAt: null,
    focusSinceLongBreak,
  };
}

/**
 * Pure, timestamp-based Pomodoro state machine. It has no timers of its own:
 * callers ask for the remaining time or poll `checkCompletion()`. Because all
 * values derive from stored timestamps, the result is identical after a VS Code
 * reload, a system sleep or a long gap between polls.
 */
export class TimerEngine {
  private state: PersistedTimerState;

  constructor(
    private readonly getConfig: () => EngineConfig,
    private readonly clock: Clock,
    initial?: PersistedTimerState
  ) {
    this.state = initial ? { ...initial } : createIdleState('focus', getConfig());
  }

  getState(): PersistedTimerState {
    return { ...this.state };
  }

  get status(): TimerStatus {
    return this.state.status;
  }

  get mode(): SessionMode {
    return this.state.mode;
  }

  elapsedMs(now: number = this.clock.now()): number {
    const s = this.state;
    if (s.status === 'idle') {
      return 0;
    }
    if (s.status === 'running' && s.segmentStartedAt !== null) {
      // A clock that moved backwards must not add negative time.
      const segment = Math.max(0, now - s.segmentStartedAt);
      return Math.min(s.durationMs, s.elapsedMs + segment);
    }
    return s.elapsedMs;
  }

  remainingMs(now: number = this.clock.now()): number {
    if (this.state.status === 'idle') {
      return this.state.durationMs;
    }
    return Math.max(0, this.state.durationMs - this.elapsedMs(now));
  }

  snapshot(now: number = this.clock.now()): TimerSnapshot {
    const s = this.state;
    const cfg = this.getConfig();
    const remainingMs = this.remainingMs(now);
    return {
      mode: s.mode,
      status: s.status,
      durationMs: s.durationMs,
      remainingMs,
      endsAt: s.status === 'running' ? now + remainingMs : null,
      cycleDone: Math.min(s.focusSinceLongBreak, cfg.sessionsBeforeLongBreak),
      cycleLength: cfg.sessionsBeforeLongBreak,
    };
  }

  /** Starts a fresh session from idle, or resumes when paused. */
  start(): boolean {
    const s = this.state;
    if (s.status === 'running') {
      return false;
    }
    if (s.status === 'paused') {
      return this.resume();
    }
    const now = this.clock.now();
    this.state = {
      ...s,
      status: 'running',
      durationMs: durationFor(s.mode, this.getConfig().durations),
      elapsedMs: 0,
      segmentStartedAt: now,
      sessionStartedAt: now,
    };
    return true;
  }

  pause(): boolean {
    const s = this.state;
    if (s.status !== 'running') {
      return false;
    }
    const now = this.clock.now();
    if (this.remainingMs(now) <= 0) {
      return false; // already finished; checkCompletion() will record it
    }
    this.state = { ...s, status: 'paused', elapsedMs: this.elapsedMs(now), segmentStartedAt: null };
    return true;
  }

  resume(): boolean {
    const s = this.state;
    if (s.status !== 'paused') {
      return false;
    }
    this.state = { ...s, status: 'running', segmentStartedAt: this.clock.now() };
    return true;
  }

  /** Discards the current session (if any) and returns to idle in the same mode. */
  reset(): boolean {
    const s = this.state;
    if (s.status === 'idle') {
      return false;
    }
    this.state = createIdleState(s.mode, this.getConfig(), s.focusSinceLongBreak);
    return true;
  }

  /** Switches session type; any session in progress is discarded. */
  setMode(mode: SessionMode): void {
    this.state = createIdleState(mode, this.getConfig(), this.state.focusSinceLongBreak);
  }

  /** Returns to a pristine focus state (used when stored data is cleared). */
  restart(): void {
    this.state = createIdleState('focus', this.getConfig(), 0);
  }

  /** Applies changed duration settings to an idle timer. In-progress sessions keep their length. */
  syncDurations(): boolean {
    const s = this.state;
    if (s.status !== 'idle') {
      return false;
    }
    const durationMs = durationFor(s.mode, this.getConfig().durations);
    if (durationMs === s.durationMs) {
      return false;
    }
    this.state = { ...s, durationMs };
    return true;
  }

  /**
   * If a running session has reached its end, finalises it and moves the timer
   * to the next (idle) mode. The end time is derived from the stored timestamps,
   * so a session that finished while VS Code was closed is credited correctly.
   */
  checkCompletion(): Completion | undefined {
    const s = this.state;
    if (s.status !== 'running' || s.segmentStartedAt === null) {
      return undefined;
    }
    if (this.remainingMs() > 0) {
      return undefined;
    }
    const endedAt = s.segmentStartedAt + (s.durationMs - s.elapsedMs);
    const startedAt = s.sessionStartedAt ?? s.segmentStartedAt;
    const session = {
      id: `${startedAt}-${s.mode}`,
      mode: s.mode,
      plannedMs: s.durationMs,
      startedAt,
      endedAt,
    };

    const cfg = this.getConfig();
    let nextMode: SessionMode = 'focus';
    let focusSinceLongBreak = s.focusSinceLongBreak;
    if (s.mode === 'focus') {
      focusSinceLongBreak += 1;
      if (cfg.autoBreakSuggestions) {
        nextMode = focusSinceLongBreak >= cfg.sessionsBeforeLongBreak ? 'longBreak' : 'shortBreak';
      }
    } else if (s.mode === 'longBreak') {
      focusSinceLongBreak = 0;
    }
    this.state = createIdleState(nextMode, cfg, focusSinceLongBreak);
    return { session, nextMode };
  }
}
