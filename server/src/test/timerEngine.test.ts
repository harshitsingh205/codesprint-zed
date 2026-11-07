import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TimerEngine } from '../core/timerEngine';
import { sanitizeTimerState } from '../core/timerState';
import { EngineConfig } from '../core/types';
import { FakeClock, makeConfig, MIN } from './helpers';

const T0 = 1_700_000_000_000;

function setup(config: EngineConfig = makeConfig()) {
  const clock = new FakeClock(T0);
  const engine = new TimerEngine(() => config, clock);
  return { clock, engine, config };
}

describe('TimerEngine countdown', () => {
  it('starts idle with the full focus duration', () => {
    const { engine } = setup();
    assert.equal(engine.status, 'idle');
    assert.equal(engine.remainingMs(), 25 * MIN);
  });

  it('counts down from timestamps, not ticks', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(10 * MIN + 30_000);
    assert.equal(engine.remainingMs(), 14 * MIN + 30_000);
    assert.equal(engine.checkCompletion(), undefined);
  });

  it('pause freezes remaining time and resume continues from it', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(5 * MIN);
    assert.ok(engine.pause());
    clock.advance(60 * MIN); // time passes while paused
    assert.equal(engine.remainingMs(), 20 * MIN);
    assert.ok(engine.resume());
    clock.advance(2 * MIN);
    assert.equal(engine.remainingMs(), 18 * MIN);
  });

  it('ignores invalid transitions', () => {
    const { engine } = setup();
    assert.equal(engine.pause(), false);
    assert.equal(engine.resume(), false);
    assert.equal(engine.reset(), false);
    engine.start();
    assert.equal(engine.start(), false); // no duplicate start
  });

  it('reset discards progress without recording a completion', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(24 * MIN);
    assert.ok(engine.reset());
    assert.equal(engine.status, 'idle');
    clock.advance(10 * MIN);
    assert.equal(engine.checkCompletion(), undefined);
    assert.equal(engine.remainingMs(), 25 * MIN);
  });

  it('never adds negative time when the clock moves backwards', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(-10 * MIN);
    assert.equal(engine.remainingMs(), 25 * MIN);
  });
});

describe('TimerEngine completion', () => {
  it('completes exactly at the end and records the true end time', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(25 * MIN + 3000); // polled 3 seconds late
    const done = engine.checkCompletion();
    assert.ok(done);
    assert.equal(done.session.mode, 'focus');
    assert.equal(done.session.plannedMs, 25 * MIN);
    assert.equal(done.session.startedAt, T0);
    assert.equal(done.session.endedAt, T0 + 25 * MIN);
    assert.equal(engine.checkCompletion(), undefined); // reported once only
  });

  it('suggests a short break, then focus again', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(25 * MIN);
    assert.equal(engine.checkCompletion()?.nextMode, 'shortBreak');
    assert.equal(engine.mode, 'shortBreak');
    assert.equal(engine.status, 'idle');
    engine.start();
    clock.advance(5 * MIN);
    const brk = engine.checkCompletion();
    assert.equal(brk?.session.mode, 'shortBreak');
    assert.equal(brk?.nextMode, 'focus');
  });

  it('suggests a long break after the configured number of focus sessions', () => {
    const { engine, clock } = setup();
    for (let i = 1; i <= 4; i++) {
      engine.setMode('focus');
      engine.start();
      clock.advance(25 * MIN);
      const done = engine.checkCompletion();
      assert.equal(done?.nextMode, i < 4 ? 'shortBreak' : 'longBreak');
    }
    assert.equal(engine.snapshot().cycleDone, 4);
    engine.start();
    clock.advance(15 * MIN);
    engine.checkCompletion();
    assert.equal(engine.snapshot().cycleDone, 0); // cycle resets after the long break
  });

  it('stays on focus when break suggestions are disabled', () => {
    const { engine, clock } = setup(makeConfig({ autoBreakSuggestions: false }));
    engine.start();
    clock.advance(25 * MIN);
    assert.equal(engine.checkCompletion()?.nextMode, 'focus');
  });

  it('gives each session a unique, stable id', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(25 * MIN);
    const a = engine.checkCompletion();
    engine.start();
    clock.advance(5 * MIN);
    const b = engine.checkCompletion();
    assert.notEqual(a?.session.id, b?.session.id);
  });
});

describe('TimerEngine restoration after reload', () => {
  it('restores a running session with the correct remaining time', () => {
    const { engine, clock, config } = setup();
    engine.start();
    clock.advance(7 * MIN);
    const saved = JSON.parse(JSON.stringify(engine.getState()));

    const reloadedClock = new FakeClock(clock.now() + 3 * MIN); // the server was closed for 3 min
    const restored = sanitizeTimerState(saved, reloadedClock.now(), config);
    assert.ok(restored);
    const reloaded = new TimerEngine(() => config, reloadedClock, restored);
    assert.equal(reloaded.status, 'running');
    assert.equal(reloaded.remainingMs(), 15 * MIN);
  });

  it('credits a session that finished while the server was closed', () => {
    const { engine, clock, config } = setup();
    engine.start();
    const saved = JSON.parse(JSON.stringify(engine.getState()));

    const reloadedClock = new FakeClock(clock.now() + 3 * 60 * MIN); // closed for 3 hours
    const restored = sanitizeTimerState(saved, reloadedClock.now(), config);
    const reloaded = new TimerEngine(() => config, reloadedClock, restored);
    const done = reloaded.checkCompletion();
    assert.ok(done);
    assert.equal(done.session.endedAt, T0 + 25 * MIN);
  });

  it('restores a paused session unchanged', () => {
    const { engine, clock, config } = setup();
    engine.start();
    clock.advance(10 * MIN);
    engine.pause();
    const saved = JSON.parse(JSON.stringify(engine.getState()));
    const reloadedClock = new FakeClock(clock.now() + 5 * 60 * MIN);
    const reloaded = new TimerEngine(() => config, reloadedClock, sanitizeTimerState(saved, reloadedClock.now(), config));
    assert.equal(reloaded.status, 'paused');
    assert.equal(reloaded.remainingMs(), 15 * MIN);
  });
});

describe('TimerEngine settings and modes', () => {
  it('follows duration changes while idle but not mid-session', () => {
    const { engine, config } = setup();
    config.durations.focusMs = 50 * MIN;
    assert.ok(engine.syncDurations());
    assert.equal(engine.remainingMs(), 50 * MIN);
    engine.start();
    config.durations.focusMs = 10 * MIN;
    assert.equal(engine.syncDurations(), false);
    assert.equal(engine.getState().durationMs, 50 * MIN);
  });

  it('switching mode discards the session in progress', () => {
    const { engine, clock } = setup();
    engine.start();
    clock.advance(10 * MIN);
    engine.setMode('longBreak');
    assert.equal(engine.status, 'idle');
    assert.equal(engine.remainingMs(), 15 * MIN);
  });
});

describe('sanitizeTimerState', () => {
  const config = makeConfig();
  const now = T0;
  const valid = {
    mode: 'focus', status: 'running', durationMs: 25 * MIN, elapsedMs: 0,
    segmentStartedAt: T0 - MIN, sessionStartedAt: T0 - MIN, focusSinceLongBreak: 1,
  };

  it('accepts valid data', () => {
    assert.ok(sanitizeTimerState(valid, now, config));
  });

  it('rejects corrupted data instead of throwing', () => {
    const bad: unknown[] = [
      undefined, null, 'x', 42, [], {},
      { ...valid, mode: 'bogus' },
      { ...valid, status: 'flying' },
      { ...valid, durationMs: -5 },
      { ...valid, durationMs: 'NaN' },
      { ...valid, elapsedMs: valid.durationMs + 1 },
      { ...valid, segmentStartedAt: null },
      { ...valid, segmentStartedAt: Number.NaN },
    ];
    for (const value of bad) {
      assert.equal(sanitizeTimerState(value, now, config), undefined);
    }
  });

  it('clamps a start time in the future', () => {
    const state = sanitizeTimerState({ ...valid, segmentStartedAt: T0 + 10 * MIN }, now, config);
    assert.equal(state?.segmentStartedAt, now);
  });
});
