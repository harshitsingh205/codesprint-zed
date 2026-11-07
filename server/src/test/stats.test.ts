import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeStats, computeStreaks } from '../core/stats';
import { addSession, emptyHistory, History } from '../core/history';
import { TimerEngine } from '../core/timerEngine';
import { at, FakeClock, makeConfig, MIN } from './helpers';

function historyWith(days: Array<[number, number, number, number]>): History {
  const h = emptyHistory();
  days.forEach(([y, m, d, count], i) => {
    for (let n = 0; n < count; n++) {
      addSession(h, {
        id: `${i}-${n}`, mode: 'focus', plannedMs: 25 * MIN,
        startedAt: at(y, m, d, 9 + n) - 25 * MIN, endedAt: at(y, m, d, 9 + n),
      });
    }
  });
  return h;
}

const NOW = at(2026, 11, 4, 15);
const GOAL = 100 * MIN;

describe('computeStats', () => {
  it('reports zeros for an empty history', () => {
    const s = computeStats(emptyHistory(), NOW, GOAL);
    assert.equal(s.todayFocusMs, 0);
    assert.equal(s.totalSessions, 0);
    assert.equal(s.currentStreak, 0);
    assert.equal(s.longestStreak, 0);
    assert.equal(s.goalPercent, 0);
    assert.equal(s.week.length, 7);
    assert.equal(s.week[6].isToday, true);
  });

  it('computes today, week and goal percentage', () => {
    const h = historyWith([[2026, 11, 4, 2], [2026, 11, 2, 1], [2026, 10, 20, 3]]);
    const s = computeStats(h, NOW, GOAL);
    assert.equal(s.todayFocusMs, 50 * MIN);
    assert.equal(s.goalPercent, 50);
    assert.equal(s.goalMet, false);
    assert.equal(s.weekFocusMs, 75 * MIN); // today + Nov 2, not Oct 20
    assert.equal(s.totalSessions, 6);
    assert.equal(s.weekActiveDays, 2);
    assert.equal(s.activeDays, 3);
  });

  it('caps the goal percentage at 100 and flags completion', () => {
    const s = computeStats(historyWith([[2026, 11, 4, 6]]), NOW, GOAL);
    assert.equal(s.goalPercent, 100);
    assert.equal(s.goalMet, true);
  });
});

describe('streaks', () => {
  it('counts consecutive days including today', () => {
    const h = historyWith([[2026, 11, 2, 1], [2026, 11, 3, 1], [2026, 11, 4, 1]]);
    const r = computeStreaks(h.days, '2026-11-04');
    assert.deepEqual([r.current, r.longest], [3, 3]);
  });

  it('keeps the streak alive when today has no session yet', () => {
    const h = historyWith([[2026, 11, 2, 1], [2026, 11, 3, 1]]);
    assert.equal(computeStreaks(h.days, '2026-11-04').current, 2);
  });

  it('breaks the streak after a missed day but remembers the longest', () => {
    const h = historyWith([[2026, 10, 1, 1], [2026, 10, 2, 1], [2026, 10, 3, 1], [2026, 11, 3, 1]]);
    const r = computeStreaks(h.days, '2026-11-04');
    assert.deepEqual([r.current, r.longest], [1, 3]);
    const old = computeStreaks(h.days, '2026-11-10');
    assert.equal(old.current, 0);
  });

  it('works across month and year boundaries', () => {
    const h = historyWith([[2025, 12, 30, 1], [2025, 12, 31, 1], [2026, 1, 1, 1]]);
    assert.equal(computeStreaks(h.days, '2026-01-01').current, 3);
  });
});

describe('incomplete sessions are never counted', () => {
  it('a reset or abandoned session leaves statistics untouched', () => {
    const clock = new FakeClock(at(2026, 11, 4, 9));
    const engine = new TimerEngine(() => makeConfig(), clock);
    const history = emptyHistory();
    engine.start();
    clock.advance(24 * MIN);
    engine.reset();
    clock.advance(30 * MIN);
    const done = engine.checkCompletion();
    if (done) addSession(history, done.session);
    assert.equal(computeStats(history, clock.now(), GOAL).totalSessions, 0);
    assert.equal(computeStats(history, clock.now(), GOAL).currentStreak, 0);
  });
});

