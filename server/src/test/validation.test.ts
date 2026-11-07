import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  COMPLETION_MESSAGES, BREAK_MESSAGES, DAILY_MESSAGES, GOAL_REACHED_MESSAGE, completionMessage, dailyMessage,
} from '../core/messages';
import { DEFAULT_SETTINGS, normalizeSettings, toEngineConfig, validateSettingValue } from '../core/settings';
import { dayKey, formatClock, formatDuration, isDayKey, shiftDayKey } from '../core/time';
import { at } from './helpers';

describe('settings model', () => {
  it('clamps out-of-range configuration and defaults invalid values', () => {
    const s = normalizeSettings({
      focusMinutes: 9999, shortBreakMinutes: -3, longBreakMinutes: 'abc', notifications: 'maybe',
      dailyGoalMinutes: 61.6,
    });
    assert.equal(s.focusMinutes, 180);
    assert.equal(s.shortBreakMinutes, 1);
    assert.equal(s.longBreakMinutes, DEFAULT_SETTINGS.longBreakMinutes);
    assert.equal(s.notifications, true);
    assert.equal(s.dailyGoalMinutes, 62);
  });

  it('converts minutes to engine milliseconds', () => {
    const cfg = toEngineConfig({ ...DEFAULT_SETTINGS, focusMinutes: 50 });
    assert.equal(cfg.durations.focusMs, 50 * 60_000);
    assert.equal(validateSettingValue('focusMinutes', 30), 30);
    assert.equal(validateSettingValue('focusMinutes', 0.5), undefined);
    assert.equal(validateSettingValue('nope', 1), undefined);
  });
});

describe('messages', () => {
  it('contains no emoji or non-ASCII symbols', () => {
    const all = [...DAILY_MESSAGES, ...COMPLETION_MESSAGES, ...BREAK_MESSAGES, GOAL_REACHED_MESSAGE];
    for (const text of all) {
      assert.match(text, /^[\x20-\x7E]+$/, text);
    }
  });

  it('is stable within a day and always returns text', () => {
    assert.equal(dailyMessage('2026-11-04'), dailyMessage('2026-11-04'));
    for (let n = 0; n < 30; n++) {
      assert.ok(completionMessage(n).length > 0);
    }
  });
});

describe('time helpers', () => {
  it('formats the clock and durations', () => {
    assert.equal(formatClock(25 * 60_000), '25:00');
    assert.equal(formatClock(24 * 60_000 + 59_100), '25:00');
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(-5), '00:00');
    assert.equal(formatDuration(75 * 60_000), '1h 15m');
    assert.equal(formatDuration(120 * 60_000), '2h');
    assert.equal(formatDuration(45 * 60_000), '45m');
  });

  it('handles day keys across boundaries', () => {
    assert.equal(dayKey(at(2026, 3, 9, 23, 59)), '2026-03-09');
    assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
    assert.equal(shiftDayKey('2024-03-01', -1), '2024-02-29');
    assert.equal(shiftDayKey('2025-12-31', 1), '2026-01-01');
    assert.equal(isDayKey('2026-02-31'), false);
  });
});
