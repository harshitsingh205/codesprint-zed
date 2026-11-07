/** Motivational copy. Plain text only: the interface never uses emojis. */

export const DAILY_MESSAGES: readonly string[] = [
  'Every expert was once a beginner.',
  'Consistency creates progress.',
  'Focus on improvement, not perfection.',
  'Every problem solved makes you better.',
  'Small sessions add up to real skill.',
  'Show up today and the results will follow.',
  'Clear code starts with a clear mind.',
  'Progress is built one focused session at a time.',
  'Debugging is how you learn how things really work.',
  'Start with the next small step.',
  'Steady practice beats occasional intensity.',
  'You do not need to be perfect to move forward.',
];

export const COMPLETION_MESSAGES: readonly string[] = [
  'Session complete. Steady work like this builds real skill.',
  'Well done. Consistency creates progress.',
  'Another focused session logged. Keep the momentum.',
  'Good work. Every problem solved makes you better.',
  'Focus session finished. Small wins compound.',
  'Nice work. Rest, then continue.',
];

export const GOAL_REACHED_MESSAGE = 'Daily goal reached. Excellent consistency today.';

export const BREAK_MESSAGES: readonly string[] = [
  'Look away from the screen and rest your eyes.',
  'Stand up, stretch and drink some water.',
  'Rest is part of the work.',
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Same message all day, different message on different days. */
export function dailyMessage(dayKeyValue: string): string {
  return DAILY_MESSAGES[hash(dayKeyValue) % DAILY_MESSAGES.length];
}

export function breakMessage(dayKeyValue: string): string {
  return BREAK_MESSAGES[hash(dayKeyValue) % BREAK_MESSAGES.length];
}

/** `sessionsToday` is the 1-based count of completed focus sessions today. */
export function completionMessage(sessionsToday: number): string {
  const index = Math.max(0, sessionsToday - 1) % COMPLETION_MESSAGES.length;
  return COMPLETION_MESSAGES[index];
}
