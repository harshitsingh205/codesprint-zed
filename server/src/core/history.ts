import { CompletedSession, SESSION_MODES } from './types';
import { dayKey, isDayKey } from './time';

export interface DayRecord {
  /** Total completed focus time on the day. */
  focusMs: number;
  /** Number of completed focus sessions on the day. */
  sessions: number;
}

export interface History {
  version: 1;
  /** Lifetime count of completed focus sessions. */
  totalSessions: number;
  /** Per-day aggregates (focus sessions only), keyed by local day. */
  days: Record<string, DayRecord>;
  /** Most recent completed sessions (focus and breaks). */
  recent: CompletedSession[];
}

export const MAX_RECENT_SESSIONS = 200;
export const MAX_DAYS = 1100;
const MAX_REASONABLE_MS = 24 * 60 * 60 * 1000;

export function emptyHistory(): History {
  return { version: 1, totalSessions: 0, days: {}, recent: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function sanitizeSession(raw: unknown): CompletedSession | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { id, mode, plannedMs, startedAt, endedAt } = raw;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > 64 ||
    !SESSION_MODES.includes(mode as never) ||
    typeof plannedMs !== 'number' ||
    !Number.isFinite(plannedMs) ||
    plannedMs <= 0 ||
    plannedMs > MAX_REASONABLE_MS ||
    typeof startedAt !== 'number' ||
    !Number.isFinite(startedAt) ||
    typeof endedAt !== 'number' ||
    !Number.isFinite(endedAt)
  ) {
    return undefined;
  }
  return { id, mode: mode as CompletedSession['mode'], plannedMs, startedAt, endedAt };
}

/** Rebuilds a valid History from untrusted stored data; never throws. */
export function sanitizeHistory(raw: unknown): History {
  const history = emptyHistory();
  if (!isRecord(raw)) {
    return history;
  }
  if (isRecord(raw.days)) {
    for (const [key, value] of Object.entries(raw.days)) {
      if (!isDayKey(key) || !isRecord(value)) {
        continue;
      }
      const { focusMs, sessions } = value;
      if (
        typeof focusMs === 'number' &&
        Number.isFinite(focusMs) &&
        focusMs >= 0 &&
        isNonNegInt(sessions)
      ) {
        history.days[key] = { focusMs, sessions };
      }
    }
  }
  if (Array.isArray(raw.recent)) {
    for (const item of raw.recent) {
      const session = sanitizeSession(item);
      if (session) {
        history.recent.push(session);
      }
    }
    history.recent = history.recent.slice(-MAX_RECENT_SESSIONS);
  }
  const sumDays = Object.values(history.days).reduce((acc, d) => acc + d.sessions, 0);
  history.totalSessions = isNonNegInt(raw.totalSessions) ? Math.max(raw.totalSessions, sumDays) : sumDays;
  return history;
}

/**
 * Records a completed session. Returns false (and changes nothing) when the
 * session id was already recorded, which makes recording idempotent.
 */
export function addSession(history: History, session: CompletedSession): boolean {
  if (history.recent.some((s) => s.id === session.id)) {
    return false;
  }
  history.recent.push(session);
  if (history.recent.length > MAX_RECENT_SESSIONS) {
    history.recent.splice(0, history.recent.length - MAX_RECENT_SESSIONS);
  }
  if (session.mode === 'focus') {
    const key = dayKey(session.endedAt);
    const day = history.days[key] ?? { focusMs: 0, sessions: 0 };
    day.focusMs += session.plannedMs;
    day.sessions += 1;
    history.days[key] = day;
    history.totalSessions += 1;

    const keys = Object.keys(history.days);
    if (keys.length > MAX_DAYS) {
      keys.sort();
      for (const old of keys.slice(0, keys.length - MAX_DAYS)) {
        delete history.days[old];
      }
    }
  }
  return true;
}
