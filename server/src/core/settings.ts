import { EngineConfig } from './types';
import { MINUTE_MS } from './time';

export interface Settings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  dailyGoalMinutes: number;
  notifications: boolean;
  autoBreakSuggestions: boolean;
  sessionsBeforeLongBreak: number;
}
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  dailyGoalMinutes: 120,
  notifications: true,
  autoBreakSuggestions: true,
  sessionsBeforeLongBreak: 4,
};

type Spec =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'boolean' };

export const SETTING_SPECS: Record<SettingKey, Spec> = {
  focusMinutes: { kind: 'int', min: 1, max: 180 },
  shortBreakMinutes: { kind: 'int', min: 1, max: 60 },
  longBreakMinutes: { kind: 'int', min: 1, max: 120 },
  dailyGoalMinutes: { kind: 'int', min: 5, max: 1440 },
  notifications: { kind: 'boolean' },
  autoBreakSuggestions: { kind: 'boolean' },
  sessionsBeforeLongBreak: { kind: 'int', min: 2, max: 10 },
};

export const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SETTING_SPECS, key);
}

/** Strictly validates a value for writing (no coercion, no clamping). */
export function validateSettingValue(key: unknown, value: unknown): string | number | boolean | undefined {
  if (!isSettingKey(key)) {
    return undefined;
  }
  const spec = SETTING_SPECS[key];
  switch (spec.kind) {
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? value : undefined;
    case 'int':
      return typeof value === 'number' && Number.isInteger(value) && value >= spec.min && value <= spec.max
        ? value
        : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
  }
}

/** Reads possibly invalid configuration, clamping numbers and defaulting everything else. */
export function normalizeSettings(raw: Partial<Record<SettingKey, unknown>>): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    const spec = SETTING_SPECS[key];
    const value = raw[key];
    if (spec.kind === 'int' && typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.min(spec.max, Math.max(spec.min, Math.round(value)));
    } else if (spec.kind === 'enum' && typeof value === 'string' && spec.values.includes(value)) {
      out[key] = value;
    } else if (spec.kind === 'boolean' && typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out as unknown as Settings;
}

export function toEngineConfig(s: Settings): EngineConfig {
  return {
    durations: {
      focusMs: s.focusMinutes * MINUTE_MS,
      shortBreakMs: s.shortBreakMinutes * MINUTE_MS,
      longBreakMs: s.longBreakMinutes * MINUTE_MS,
    },
    autoBreakSuggestions: s.autoBreakSuggestions,
    sessionsBeforeLongBreak: s.sessionsBeforeLongBreak,
  };
}
