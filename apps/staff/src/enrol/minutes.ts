/** Whole minutes to wait, at least one, for the shared "try again in # minutes" message. */
export const minutesFrom = (seconds: number | null): number =>
  Math.max(1, Math.ceil((seconds && seconds > 0 ? seconds : 60) / 60));
