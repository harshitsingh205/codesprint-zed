import { createIdleState, MAX_DURATION_MS, MIN_DURATION_MS } from './timerEngine';
import {
  EngineConfig,
  PersistedTimerState,
  SESSION_MODES,
  TIMER_STATUSES,
} from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validates stored timer data. Anything missing, malformed or out of range
 * yields `undefined` so the caller falls back to a clean idle timer instead of
 * crashing on corrupted storage.
 */
export function sanitizeTimerState(
  raw: unknown,
  now: number,
  config: EngineConfig
): PersistedTimerState | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { mode, status, durationMs, elapsedMs, segmentStartedAt, sessionStartedAt, focusSinceLongBreak } = raw;

  if (!SESSION_MODES.includes(mode as never) || !TIMER_STATUSES.includes(status as never)) {
    return undefined;
  }
  const safeMode = mode as PersistedTimerState['mode'];
  const safeStatus = status as PersistedTimerState['status'];
  const cycle =
    typeof focusSinceLongBreak === 'number' && Number.isInteger(focusSinceLongBreak)
      ? Math.min(Math.max(focusSinceLongBreak, 0), 1000)
      : 0;

  if (safeStatus === 'idle') {
    return createIdleState(safeMode, config, cycle);
  }
  if (!isFiniteNumber(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    return undefined;
  }
  if (!isFiniteNumber(elapsedMs) || elapsedMs < 0 || elapsedMs > durationMs) {
    return undefined;
  }

  let segment: number | null = null;
  if (safeStatus === 'running') {
    if (!isFiniteNumber(segmentStartedAt) || segmentStartedAt <= 0) {
      return undefined;
    }
    segment = Math.min(segmentStartedAt, now); // never trust a start time in the future
  }
  const started = isFiniteNumber(sessionStartedAt) && sessionStartedAt > 0 ? Math.min(sessionStartedAt, now) : segment ?? now;

  return {
    mode: safeMode,
    status: safeStatus,
    durationMs,
    elapsedMs,
    segmentStartedAt: segment,
    sessionStartedAt: started,
    focusSinceLongBreak: cycle,
  };
}
