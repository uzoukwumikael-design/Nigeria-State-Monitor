import { describe, expect, it } from "vitest";
import { CIRCUIT_FAILURE_THRESHOLD, circuitState, pauseDurationMs } from "./circuit";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("pauseDurationMs", () => {
  it("is zero below the threshold, 30 minutes at it, doubling after, and capped at 24 hours", () => {
    expect(pauseDurationMs(0)).toBe(0);
    expect(pauseDurationMs(CIRCUIT_FAILURE_THRESHOLD - 1)).toBe(0);
    expect(pauseDurationMs(5)).toBe(30 * 60_000);
    expect(pauseDurationMs(6)).toBe(60 * 60_000);
    expect(pauseDurationMs(7)).toBe(120 * 60_000);
    expect(pauseDurationMs(40)).toBe(24 * 60 * 60_000);
  });
});

describe("circuitState", () => {
  it("stays closed while a source is healthy or has only a few failures", () => {
    expect(circuitState({ consecutiveFailures: 0, lastCheckedAt: minutesAgo(1) }, NOW).open).toBe(false);
    expect(circuitState({ consecutiveFailures: 4, lastCheckedAt: minutesAgo(1) }, NOW).open).toBe(false);
  });

  it("opens after repeated failures and says when a trial run is allowed", () => {
    const state = circuitState({ consecutiveFailures: 5, lastCheckedAt: minutesAgo(10) }, NOW);
    expect(state.open).toBe(true);
    expect(state.retryAt).toBe(new Date(NOW.getTime() + 20 * 60_000).toISOString());
  });

  it("allows one trial run once the pause has passed, and pauses longer if that fails", () => {
    expect(circuitState({ consecutiveFailures: 5, lastCheckedAt: minutesAgo(31) }, NOW).open).toBe(false);
    expect(circuitState({ consecutiveFailures: 6, lastCheckedAt: minutesAgo(31) }, NOW).open).toBe(true);
    expect(circuitState({ consecutiveFailures: 6, lastCheckedAt: minutesAgo(61) }, NOW).open).toBe(false);
  });

  it("treats missing or unparseable timestamps as closed so a source is never paused forever", () => {
    expect(circuitState({ consecutiveFailures: 9, lastCheckedAt: null }, NOW).open).toBe(false);
    expect(circuitState({ consecutiveFailures: 9, lastCheckedAt: "garbage" }, NOW).open).toBe(false);
  });
});
