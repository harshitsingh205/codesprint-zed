import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { addSession, emptyHistory, MAX_DAYS, MAX_RECENT_SESSIONS, sanitizeHistory } from '../core/history';
import { Store, STORAGE_KEYS } from '../core/storage';
import { CompletedSession } from '../core/types';
import { at, makeConfig, MemoryStore, MIN } from './helpers';

const focus = (id: string, endedAt: number, ms = 25 * MIN): CompletedSession => ({
  id, mode: 'focus', plannedMs: ms, startedAt: endedAt - ms, endedAt,
});

describe('session tracking', () => {
  it('aggregates completed focus sessions per day', () => {
    const h = emptyHistory();
    assert.ok(addSession(h, focus('a', at(2026, 11, 4, 10))));
    assert.ok(addSession(h, focus('b', at(2026, 11, 4, 14))));
    assert.ok(addSession(h, focus('c', at(2026, 11, 5, 9))));
    assert.deepEqual(h.days['2026-11-04'], { focusMs: 50 * MIN, sessions: 2 });
    assert.equal(h.days['2026-11-05']?.sessions, 1);
    assert.equal(h.totalSessions, 3);
  });

  it('does not count breaks as focus time or sessions', () => {
    const h = emptyHistory();
    addSession(h, { id: 'b', mode: 'shortBreak', plannedMs: 5 * MIN, startedAt: 0, endedAt: at(2026, 11, 4) });
    assert.equal(h.totalSessions, 0);
    assert.deepEqual(h.days, {});
    assert.equal(h.recent.length, 1);
  });

  it('is idempotent: recording the same session twice counts once', () => {
    const h = emptyHistory();
    assert.ok(addSession(h, focus('same', at(2026, 11, 4))));
    assert.equal(addSession(h, focus('same', at(2026, 11, 4))), false);
    assert.equal(h.totalSessions, 1);
    assert.equal(h.days['2026-11-04']?.sessions, 1);
  });

  it('attributes a session to the day it ended', () => {
    const h = emptyHistory();
    addSession(h, focus('late', at(2026, 11, 5, 0, 10)));
    assert.equal(h.days['2026-11-05']?.sessions, 1);
  });

  it('caps the recent session log and the number of stored days', () => {
    const h = emptyHistory();
    for (let i = 0; i < MAX_RECENT_SESSIONS + 20; i++) {
      addSession(h, focus(`s${i}`, at(2026, 1, 1) + i * 1000));
    }
    assert.equal(h.recent.length, MAX_RECENT_SESSIONS);
    const big = emptyHistory();
    for (let i = 0; i < MAX_DAYS + 5; i++) {
      addSession(big, focus(`d${i}`, at(2020, 1, 1) + i * 86_400_000));
    }
    assert.ok(Object.keys(big.days).length <= MAX_DAYS);
    assert.equal(big.totalSessions, MAX_DAYS + 5); // lifetime counter survives pruning
  });
});

describe('sanitizeHistory', () => {
  it('falls back to empty on garbage', () => {
    for (const bad of [undefined, null, 'x', 5, [], { days: 'no' }]) {
      const h = sanitizeHistory(bad);
      assert.equal(h.totalSessions, 0);
      assert.deepEqual(h.days, {});
    }
  });

  it('drops invalid entries but keeps valid ones', () => {
    const h = sanitizeHistory({
      totalSessions: 'x',
      days: {
        '2026-11-04': { focusMs: 1500000, sessions: 1 },
        'not-a-day': { focusMs: 1, sessions: 1 },
        '2026-02-31': { focusMs: 1, sessions: 1 },
        '2026-11-05': { focusMs: -1, sessions: 1 },
        '2026-11-06': { focusMs: 5, sessions: 1.5 },
      },
      recent: [{ id: 'ok', mode: 'focus', plannedMs: 1000, startedAt: 1, endedAt: 2 }, { id: 3 }, null],
    });
    assert.deepEqual(Object.keys(h.days), ['2026-11-04']);
    assert.equal(h.recent.length, 1);
    assert.equal(h.totalSessions, 1);
  });
});

describe('Store persistence', () => {
  it('round-trips sessions through storage', async () => {
    const kv = new MemoryStore();
    const store = new Store(kv);
    assert.ok(await store.recordSession(focus('x', at(2026, 11, 4))));
    assert.equal(await store.recordSession(focus('x', at(2026, 11, 4))), false);
    const reopened = new Store(kv); // simulates a server restart
    assert.equal(reopened.loadHistory().totalSessions, 1);
  });

  it('round-trips and validates timer state', async () => {
    const kv = new MemoryStore();
    const store = new Store(kv);
    const config = makeConfig();
    const state = {
      mode: 'focus' as const, status: 'paused' as const, durationMs: 25 * MIN, elapsedMs: 5 * MIN,
      segmentStartedAt: null, sessionStartedAt: 1000, focusSinceLongBreak: 2,
    };
    await store.saveTimerState(state);
    assert.deepEqual(store.loadTimerState(config, Date.now()), state);
  });

  it('survives corrupted stored values', () => {
    const kv = new MemoryStore();
    kv.data.set(STORAGE_KEYS.timer, { mode: 'nope' });
    kv.data.set(STORAGE_KEYS.history, 'garbage');
    const store = new Store(kv);
    assert.equal(store.loadTimerState(makeConfig(), Date.now()), undefined);
    assert.equal(store.loadHistory().totalSessions, 0);
  });

  it('clearAll removes sessions and timer state', async () => {
    const kv = new MemoryStore();
    const store = new Store(kv);
    await store.recordSession(focus('x', at(2026, 11, 4)));
    await store.clearAll();
    assert.equal(store.loadHistory().totalSessions, 0);
  });
});
