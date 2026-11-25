/** Consecutive failed runs before a source is paused. */
export const CIRCUIT_FAILURE_THRESHOLD = 5;
const BASE_PAUSE_MS = 30 * 60 * 1000;
const MAX_PAUSE_MS = 24 * 60 * 60 * 1000;

export interface CircuitInput {
  consecutiveFailures: number;
  /** When the last attempt (the last failure, if failing) happened, ISO. */
  lastCheckedAt: string | null;
}

export interface CircuitState {
  open: boolean;
  /** When the next trial run is allowed, ISO, while the circuit is open. */
  retryAt: string | null;
  /** How long the pause lasts for this many failures, in ms (0 while healthy). */
  pauseMs: number;
}

/** Pause length: 30 minutes at the threshold, doubling with each further failure, capped at 24 hours. */
export function pauseDurationMs(consecutiveFailures: number): number {
  if (consecutiveFailures < CIRCUIT_FAILURE_THRESHOLD) return 0;
  const doublings = consecutiveFailures - CIRCUIT_FAILURE_THRESHOLD;
  return Math.min(BASE_PAUSE_MS * 2 ** Math.min(doublings, 10), MAX_PAUSE_MS);
}

/**
 * A feed that keeps failing is paused so we stop hammering a dead or blocking site and stop wasting run time.
 * After the pause one trial run is allowed; if it fails the pause doubles, if it succeeds the count resets.
 */
export function circuitState(input: CircuitInput, now: Date = new Date()): CircuitState {
  const pauseMs = pauseDurationMs(input.consecutiveFailures);
  if (pauseMs === 0 || !input.lastCheckedAt) return { open: false, retryAt: null, pauseMs };
  const last = Date.parse(input.lastCheckedAt);
  if (Number.isNaN(last)) return { open: false, retryAt: null, pauseMs };
  const retryAtMs = last + pauseMs;
  if (now.getTime() >= retryAtMs) return { open: false, retryAt: null, pauseMs };
  return { open: true, retryAt: new Date(retryAtMs).toISOString(), pauseMs };
}
