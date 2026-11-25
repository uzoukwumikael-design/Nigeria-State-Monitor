import { describe, expect, it } from "vitest";
import { buildSourceStatus, type SourceHealthRecord } from "./source-status";
import { INGESTION_SOURCES, SOURCE_EVIDENCE } from "./sources";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const health = (overrides: Partial<SourceHealthRecord>): SourceHealthRecord => ({
  status: "healthy",
  consecutiveFailures: 0,
  lastCheckedAt: ago(5),
  lastSuccessfulSync: ago(5),
  lastError: null,
  ...overrides,
});
const sources = INGESTION_SOURCES.slice(0, 5);
const [a, b, c, d, e] = sources.map((source) => source.slug) as [string, string, string, string, string];

describe("buildSourceStatus", () => {
  const map = new Map<string, SourceHealthRecord>([
    [a, health({})],
    [b, health({ status: "down", consecutiveFailures: 2, lastSuccessfulSync: null, lastError: "HTTP 503" })],
    [c, health({ status: "down", consecutiveFailures: 6, lastCheckedAt: ago(10), lastError: "robots.txt disallows /feed/" })],
    // d never ran
  ]);
  const activity = new Map([[a, { articlesLast24h: 12, articlesTotal: 90 }]]);

  it("classifies healthy, failing, paused and never-run sources and summarises them", () => {
    const { rows, summary } = buildSourceStatus({ sources, evidence: SOURCE_EVIDENCE, health: map, activity, now: NOW });
    const byState = Object.fromEntries(rows.map((row) => [row.slug, row.state]));
    expect(byState[a]).toBe("healthy");
    expect(byState[b]).toBe("failing");
    expect(byState[c]).toBe("paused");
    expect(byState[d]).toBe("never_run");
    expect(byState[e]).toBe("never_run");
    expect(summary).toEqual({ total: 5, healthy: 1, failing: 1, paused: 1, neverRun: 2, unknown: 0, disabled: 0 });
  });

  it("says when a paused source will be retried and keeps its last error", () => {
    const row = buildSourceStatus({ sources, evidence: SOURCE_EVIDENCE, health: map, activity, now: NOW }).rows.find((item) => item.slug === c)!;
    // six failures pause for 60 minutes; the last attempt was 10 minutes ago
    expect(row.retryAt).toBe(new Date(NOW.getTime() + 50 * 60_000).toISOString());
    expect(row.lastError).toMatch(/robots/);
  });

  it("reports activity counts, zero for a source with none, and carries each source's evidence label", () => {
    const rows = buildSourceStatus({ sources, evidence: SOURCE_EVIDENCE, health: map, activity, now: NOW }).rows;
    expect(rows.find((row) => row.slug === a)).toMatchObject({ articlesLast24h: 12, articlesTotal: 90, evidenceLevel: "verified" });
    expect(rows.find((row) => row.slug === b)?.articlesLast24h).toBe(0);
  });

  it("never invents health without a database: every source is unknown and counts are null", () => {
    const { rows, summary } = buildSourceStatus({ sources, evidence: SOURCE_EVIDENCE, health: null, activity: null, now: NOW });
    expect(rows.every((row) => row.state === "unknown" && row.articlesLast24h === null)).toBe(true);
    expect(summary.unknown).toBe(5);
  });
});
