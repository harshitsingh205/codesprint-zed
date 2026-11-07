import { formatStats, formatStatus, MODE_LABELS } from './core/format';
import { DEFAULT_SETTINGS, normalizeSettings, Settings } from './core/settings';
import { computeStats } from './core/stats';
import { MINUTE_MS } from './core/time';
import { SESSION_MODES, SessionMode } from './core/types';
import { Clock, SYSTEM_CLOCK } from './core/types';
import { TimerService } from './core/timerService';
import { McpServer } from './mcp/protocol';

export const SERVER_VERSION = '1.0.0';

/** Parses the JSON settings the Zed extension passes in CODESPRINT_SETTINGS. Never throws. */
export function parseSettings(raw: string | undefined): Settings {
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeSettings(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function createServer(
  service: TimerService,
  getSettings: () => Settings,
  clock: Clock = SYSTEM_CLOCK,
  write?: (line: string) => void
): McpServer {
  const server = new McpServer(
    {
      name: 'codesprint',
      title: 'CodeSprint',
      version: SERVER_VERSION,
      instructions:
        'CodeSprint is a Pomodoro focus timer with daily goals, streaks and statistics. ' +
        'Use the codesprint_* tools when the user wants to start, pause, resume or reset a focus session, ' +
        'switch to a break, or see their progress. Only completed sessions are counted.',
    },
    write
  );

  const status = async (prefix?: string): Promise<string> => {
    const { timer, completionText } = await service.snapshot();
    const body = formatStatus(timer, getSettings(), service.history(), clock.now());
    return [prefix, completionText, body].filter(Boolean).join('\n\n');
  };

  const act = (label: string, noop: string, run: () => ReturnType<TimerService['start']>) => async () => {
    const result = await run();
    return status(result.changed ? label : noop);
  };

  const noArgs = { type: 'object' as const, properties: {}, additionalProperties: false };

  server.addTool({
    name: 'codesprint_status',
    title: 'Timer status',
    description: 'Show the current timer state, time remaining and progress toward the daily goal.',
    inputSchema: noArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: () => status(),
  });
  server.addTool({
    name: 'codesprint_start',
    title: 'Start timer',
    description: 'Start a session of the current type (focus by default), or resume it if it is paused.',
    inputSchema: noArgs,
    annotations: { idempotentHint: true, openWorldHint: false },
    handler: act('Started.', 'The timer is already running.', () => service.start()),
  });
  server.addTool({
    name: 'codesprint_pause',
    title: 'Pause timer',
    description: 'Pause the running session. Remaining time is kept.',
    inputSchema: noArgs,
    annotations: { idempotentHint: true, openWorldHint: false },
    handler: act('Paused.', 'Nothing to pause: the timer is not running.', () => service.pause()),
  });
  server.addTool({
    name: 'codesprint_resume',
    title: 'Resume timer',
    description: 'Resume a paused session.',
    inputSchema: noArgs,
    annotations: { idempotentHint: true, openWorldHint: false },
    handler: act('Resumed.', 'Nothing to resume: the timer is not paused.', () => service.resume()),
  });
  server.addTool({
    name: 'codesprint_reset',
    title: 'Reset timer',
    description: 'Discard the session in progress and return to idle. Unfinished sessions are never counted.',
    inputSchema: noArgs,
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: act('Session discarded.', 'Nothing to reset: the timer is idle.', () => service.reset()),
  });
  server.addTool({
    name: 'codesprint_switch_mode',
    title: 'Switch session type',
    description:
      'Switch between focus, shortBreak and longBreak. A session in progress is discarded, so confirm with the user first if one is running.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: [...SESSION_MODES], description: 'The session type to switch to.' } },
      required: ['mode'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const mode = args.mode as SessionMode;
      if (!SESSION_MODES.includes(mode)) {
        throw new Error(`mode must be one of: ${SESSION_MODES.join(', ')}.`);
      }
      const result = await service.setMode(mode);
      return status(result.changed ? `Switched to ${MODE_LABELS[mode]}.` : `Already on ${MODE_LABELS[mode]}.`);
    },
  });
  const statsText = async (): Promise<string> => {
    const goalMinutes = getSettings().dailyGoalMinutes;
    await service.snapshot(); // credits a session that just finished
    return formatStats(computeStats(service.history(), clock.now(), goalMinutes * MINUTE_MS), goalMinutes);
  };
  server.addTool({
    name: 'codesprint_stats',
    title: 'Productivity statistics',
    description: 'Show today, weekly totals, completed sessions, current and longest streak and a 7-day overview.',
    inputSchema: noArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: statsText,
  });
  server.addTool({
    name: 'codesprint_clear_data',
    title: 'Clear stored data',
    description:
      'Permanently delete all stored sessions, streaks and timer state. Irreversible: only call after the user has explicitly confirmed.',
    inputSchema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', description: 'Must be true to proceed.' } },
      required: ['confirm'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      if (args.confirm !== true) {
        throw new Error('Refusing to delete data without confirm: true.');
      }
      await service.clearAllData();
      return 'All CodeSprint data has been cleared.';
    },
  });

  server.addPrompt({
    name: 'status',
    title: 'Timer status',
    description: 'Insert the current CodeSprint timer status into the conversation.',
    handler: () => status(),
  });
  server.addPrompt({
    name: 'stats',
    title: 'Productivity statistics',
    description: 'Insert your CodeSprint streaks and weekly statistics into the conversation.',
    handler: statsText,
  });

  return server;
}
