import { EngineConfig, Clock } from '../core/types';
import { KeyValueStore } from '../core/storage';

export const MIN = 60_000;

export class FakeClock implements Clock {
  constructor(public time: number) {}
  now(): number {
    return this.time;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

export function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    durations: { focusMs: 25 * MIN, shortBreakMs: 5 * MIN, longBreakMs: 15 * MIN },
    autoBreakSuggestions: true,
    sessionsBeforeLongBreak: 4,
    ...overrides,
  };
}

/** In-memory stand-in for vscode.Memento. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    const value = this.data.get(key);
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
  }
  update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
    return Promise.resolve();
  }
}

/** Local-time timestamp helper. Month is 1-based. */
export const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();
