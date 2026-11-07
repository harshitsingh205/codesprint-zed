import * as fs from 'node:fs';
import * as path from 'node:path';
import { CompletedSession, EngineConfig, PersistedTimerState } from './types';
import { sanitizeTimerState } from './timerState';
import { addSession, emptyHistory, History, sanitizeHistory } from './history';

/** Minimal key-value contract so storage can be unit tested without touching the disk. */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export const STORAGE_KEYS = {
  timer: 'codesprint.timer.v1',
  history: 'codesprint.history.v1',
} as const;

export class Store {
  constructor(private readonly kv: KeyValueStore) {}

  private read(key: string): unknown {
    try {
      return this.kv.get<unknown>(key);
    } catch {
      return undefined;
    }
  }

  loadTimerState(config: EngineConfig, now: number): PersistedTimerState | undefined {
    return sanitizeTimerState(this.read(STORAGE_KEYS.timer), now, config);
  }

  saveTimerState(state: PersistedTimerState): PromiseLike<void> {
    return this.kv.update(STORAGE_KEYS.timer, state);
  }

  loadHistory(): History {
    return sanitizeHistory(this.read(STORAGE_KEYS.history));
  }

  /** Persists a completed session. Returns false when it was already recorded. */
  async recordSession(session: CompletedSession): Promise<boolean> {
    const history = this.loadHistory();
    if (!addSession(history, session)) {
      return false;
    }
    await this.kv.update(STORAGE_KEYS.history, history);
    return true;
  }

  async clearAll(): Promise<void> {
    await this.kv.update(STORAGE_KEYS.timer, undefined);
    await this.kv.update(STORAGE_KEYS.history, emptyHistory());
  }
}

/**
 * JSON-file backed store. Every write goes to a temporary file first and is
 * then renamed over the target, so a crash can never leave a half-written
 * file. Reads always hit the disk, which keeps several Zed windows (each with
 * its own server process) consistent with one another.
 */
export class FileStore implements KeyValueStore {
  constructor(private readonly file: string) {}

  private readAll(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  get<T>(key: string): T | undefined {
    return this.readAll()[key] as T | undefined;
  }

  update(key: string, value: unknown): Promise<void> {
    const data = this.readAll();
    if (value === undefined) {
      delete data[key];
    } else {
      data[key] = value;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return Promise.resolve();
  }
}

/** Resolves the per-user data directory without any dependency. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.CODESPRINT_DATA_DIR) {
    return env.CODESPRINT_DATA_DIR;
  }
  const home = env.HOME ?? env.USERPROFILE ?? '.';
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'CodeSprint');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CodeSprint');
  }
  return path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'codesprint');
}
