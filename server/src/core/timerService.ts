import { MODE_LABELS } from './format';
import { completionMessage, GOAL_REACHED_MESSAGE } from './messages';
import { Settings, toEngineConfig } from './settings';
import { Store } from './storage';
import { TimerEngine } from './timerEngine';
import { Clock, Completion, SESSION_MODES, SessionMode, SYSTEM_CLOCK, TimerSnapshot } from './types';
import { dayKey, MINUTE_MS } from './time';


export interface Notifier {
  notify(title: string, body: string): void;
}

export interface ActionResult {
  /** False when the request was a no-op (for example pausing an idle timer). */
  changed: boolean;
  /** Message produced if a session finished while handling the request. */
  completionText?: string;
}

/**
 * Headless timer orchestration. The engine is rebuilt from the store on every
 * call, so state is always read fresh from disk and nothing is cached in
 * memory: multiple Zed windows (one server process each) stay consistent and a
 * restart loses nothing. The only in-memory state is one wake-up timer that
 * fires the desktop notification when the running session ends.
 */
export class TimerService {
  private wake: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: Store,
    private readonly getSettings: () => Settings,
    private readonly notifier: Notifier,
    private readonly clock: Clock = SYSTEM_CLOCK
  ) {}

  private engine(): TimerEngine {
    const getConfig = () => toEngineConfig(this.getSettings());
    return new TimerEngine(getConfig, this.clock, this.store.loadTimerState(getConfig(), this.clock.now()));
  }

  private async finalize(engine: TimerEngine): Promise<string | undefined> {
    const completion = engine.checkCompletion();
    if (!completion) {
      return undefined;
    }
    await this.store.recordSession(completion.session); // idempotent by session id
    await this.store.saveTimerState(engine.getState());
    const text = this.completionTextFor(completion);
    this.notifyCompletion(completion, text);
    return text;
  }

  private completionTextFor(completion: Completion): string | undefined {
    const { session } = completion;
    if (session.mode !== 'focus') {
      return undefined;
    }
    const today = this.store.loadHistory().days[dayKey(session.endedAt)];
    const goalMs = this.getSettings().dailyGoalMinutes * MINUTE_MS;
    const justReached = !!today && today.focusMs >= goalMs && today.focusMs - session.plannedMs < goalMs;
    return justReached ? GOAL_REACHED_MESSAGE : completionMessage(today?.sessions ?? 1);
  }

  private notifyCompletion(completion: Completion, text: string | undefined): void {
    if (!this.getSettings().notifications) {
      return;
    }
    const { session, nextMode } = completion;
    const minutes = Math.max(1, Math.round(session.plannedMs / MINUTE_MS));
    if (session.mode === 'focus') {
      const next = nextMode === 'focus' ? '' : ` Next: ${MODE_LABELS[nextMode]}.`;
      this.notifier.notify('CodeSprint - focus session complete', `${minutes} min logged.${next} ${text ?? ''}`.trim());
    } else {
      this.notifier.notify(`CodeSprint - ${MODE_LABELS[session.mode]} finished`, 'Ready for the next focus session?');
    }
  }

  /** Arms (or disarms) the single wake-up timer for the current engine state. */
  private schedule(engine: TimerEngine): void {
    if (this.wake) {
      clearTimeout(this.wake);
      this.wake = undefined;
    }
    if (engine.status !== 'running') {
      return;
    }
    const delay = Math.min(engine.remainingMs() + 250, 2 ** 31 - 1);
    this.wake = setTimeout(() => void this.tick(), delay);
    this.wake.unref();
  }

  private async tick(): Promise<void> {
    const engine = this.engine();
    await this.finalize(engine);
    this.schedule(engine);
  }

  /** Call once at startup: credits sessions that ended while no server was running. */
  async initialize(): Promise<void> {
    const engine = this.engine();
    await this.finalize(engine);
    this.schedule(engine);
  }

  async snapshot(): Promise<{ timer: TimerSnapshot; completionText?: string }> {
    const engine = this.engine();
    const completionText = await this.finalize(engine);
    this.schedule(engine);
    return { timer: engine.snapshot(), completionText };
  }

  private async run(action: (e: TimerEngine) => boolean, reschedule = true): Promise<ActionResult> {
    const engine = this.engine();
    const completionText = await this.finalize(engine);
    const changed = action(engine);
    if (changed) {
      await this.store.saveTimerState(engine.getState());
    }
    if (reschedule) {
      this.schedule(engine);
    }
    return { changed, completionText };
  }

  start(): Promise<ActionResult> {
    return this.run((e) => e.start());
  }
  pause(): Promise<ActionResult> {
    return this.run((e) => e.pause());
  }
  resume(): Promise<ActionResult> {
    return this.run((e) => e.resume());
  }
  reset(): Promise<ActionResult> {
    return this.run((e) => e.reset());
  }

  /** Changing the session type discards a session in progress, exactly like the VS Code version. */
  setMode(mode: SessionMode): Promise<ActionResult> {
    if (!SESSION_MODES.includes(mode)) {
      return Promise.resolve({ changed: false });
    }
    return this.run((e) => {
      if (e.mode === mode) {
        return false;
      }
      e.setMode(mode);
      return true;
    });
  }

  async clearAllData(): Promise<void> {
    await this.store.clearAll();
    if (this.wake) {
      clearTimeout(this.wake);
      this.wake = undefined;
    }
  }

  history() {
    return this.store.loadHistory();
  }

  dispose(): void {
    if (this.wake) {
      clearTimeout(this.wake);
    }
  }
}
