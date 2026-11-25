import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import {
  type HistoryScope,
  addDays,
  buildHistory,
  chooseBucket,
  daysBetween,
  isValidDayKey,
  resolveHistoryRange,
} from "@/lib/intelligence/history";
import { historyQuerySchema } from "@/lib/validation/query";
import type { DatasetCoverage, IntelligenceEvent } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const NONE: HistoryScope = { stateId: null, zone: null, category: null };

function fakeEvent(partial: Partial<IntelligenceEvent> & { id: string; at: string }): IntelligenceEvent {
  const base = snapshot.events[0]!;
  return {
    ...base,
    id: partial.id,
    title: partial.title ?? partial.id,
    occurrenceAt: partial.at,
    firstReportedAt: partial.at,
    lastUpdatedAt: partial.at,
    severity: partial.severity ?? 2,
    category: partial.category ?? "security",
    stateId: partial.stateId ?? "NG-LA",
    stateName: partial.stateName ?? "Lagos",
    zone: partial.zone ?? "south-west",
    verificationStatus: partial.verificationStatus ?? "single_source",
  };
}

const coverage: DatasetCoverage = {
  from: "2026-03-10T10:00:00.000Z",
  to: "2026-03-20T10:00:00.000Z",
  basis: "live_ingestion",
  label: "Live ingestion from 10 March 2026",
};

describe("day-key helpers", () => {
  it("validates real calendar days only", () => {
    expect(isValidDayKey("2026-02-28")).toBe(true);
    expect(isValidDayKey("2026-02-30")).toBe(false);
    expect(isValidDayKey("2026-13-01")).toBe(false);
    expect(isValidDayKey("26-01-01")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(31);
  });

  it("chooses day, week or month buckets by span", () => {
    expect(chooseBucket(30)).toBe("day");
    expect(chooseBucket(90)).toBe("week");
    expect(chooseBucket(900)).toBe("month");
  });
});

describe("resolveHistoryRange", () => {
  it("accepts a custom inclusive range and rejects bad ones", () => {
    expect(resolveHistoryRange({ kind: "custom", from: "2026-03-01", to: "2026-03-10" }, DEMO_REFERENCE_TIME, coverage)).toEqual({
      ok: true,
      range: { from: "2026-03-01", to: "2026-03-10" },
    });
    expect(resolveHistoryRange({ kind: "custom", from: "2026-03-10", to: "2026-03-01" }, DEMO_REFERENCE_TIME, coverage).ok).toBe(false);
    expect(resolveHistoryRange({ kind: "custom", from: "2026-02-30", to: "2026-03-01" }, DEMO_REFERENCE_TIME, coverage).ok).toBe(false);
    expect(resolveHistoryRange({ kind: "custom", from: "2000-01-01", to: "2026-03-01" }, DEMO_REFERENCE_TIME, coverage).ok).toBe(false);
  });

  it("resolves 'all' to the first held record, or just today when none exist", () => {
    const withData = resolveHistoryRange({ kind: "window", window: "all" }, "2026-03-25T09:00:00Z", coverage);
    expect(withData).toEqual({ ok: true, range: { from: "2026-03-10", to: "2026-03-25" } });
    const none = resolveHistoryRange({ kind: "window", window: "all" }, "2026-03-25T09:00:00Z", { from: null, to: null });
    expect(none).toEqual({ ok: true, range: { from: "2026-03-25", to: "2026-03-25" } });
  });

  it("resolves a preset window relative to the reference time", () => {
    const result = resolveHistoryRange({ kind: "window", window: "7d" }, "2026-03-25T09:00:00Z", coverage);
    expect(result).toEqual({ ok: true, range: { from: "2026-03-18", to: "2026-03-25" } });
  });
});

describe("buildHistory", () => {
  const events = [
    fakeEvent({ id: "a", at: "2026-03-11T08:00:00.000Z", severity: 5 }),
    fakeEvent({ id: "b", at: "2026-03-11T20:00:00.000Z", severity: 2, category: "economy" }),
    fakeEvent({ id: "c", at: "2026-03-15T09:00:00.000Z", severity: 4, stateId: "NG-KN", stateName: "Kano", zone: "north-west", verificationStatus: "corroborated" }),
    fakeEvent({ id: "d", at: "2026-03-19T09:00:00.000Z", severity: 1 }),
  ];
  const run = (range: { from: string; to: string }, scope: HistoryScope = NONE) =>
    buildHistory({
      events,
      states: snapshot.states,
      coverage,
      referenceIso: "2026-03-20T12:00:00Z",
      range,
      scope,
    });

  it("zero-fills a daily series across the full range and counts each event once", () => {
    const result = run({ from: "2026-03-10", to: "2026-03-20" });
    expect(result.bucket).toBe("day");
    expect(result.series).toHaveLength(11);
    expect(result.series.reduce((sum, point) => sum + point.total, 0)).toBe(4);
    expect(result.totals).toMatchObject({ events: 4, severity4Plus: 2, critical: 1, corroborated: 1, statesReporting: 2 });
    expect(result.series.find((point) => point.start === "2026-03-12")?.total).toBe(0);
    expect(result.series.find((point) => point.start === "2026-03-11")?.total).toBe(2);
  });

  it("buckets by Lagos calendar day, not UTC", () => {
    // 23:30 UTC on the 11th is 00:30 WAT on the 12th.
    const late = fakeEvent({ id: "late", at: "2026-03-11T23:30:00.000Z" });
    const result = buildHistory({
      events: [late],
      states: snapshot.states,
      coverage,
      referenceIso: "2026-03-20T12:00:00Z",
      range: { from: "2026-03-11", to: "2026-03-12" },
      scope: NONE,
    });
    expect(result.series.find((point) => point.start === "2026-03-12")?.total).toBe(1);
    expect(result.series.find((point) => point.start === "2026-03-11")?.total).toBe(0);
  });

  it("applies state, zone and category scope", () => {
    expect(run({ from: "2026-03-10", to: "2026-03-20" }, { stateId: "NG-KN", zone: null, category: null }).totals.events).toBe(1);
    expect(run({ from: "2026-03-10", to: "2026-03-20" }, { stateId: null, zone: "south-west", category: null }).totals.events).toBe(3);
    expect(run({ from: "2026-03-10", to: "2026-03-20" }, { stateId: null, zone: null, category: "economy" }).totals.events).toBe(1);
    expect(run({ from: "2026-03-10", to: "2026-03-20" }, { stateId: "NG-KN", zone: null, category: null }).scope.label).toBe("Kano");
  });

  it("lists only notable events newest first", () => {
    const result = run({ from: "2026-03-10", to: "2026-03-20" });
    expect(result.timeline.map((entry) => entry.id)).toEqual(["c", "a"]);
  });

  it("compares with the equal-length period before and flags non-comparable baselines", () => {
    const result = run({ from: "2026-03-15", to: "2026-03-20" });
    expect(result.days).toBe(6);
    expect(result.previous).toMatchObject({ from: "2026-03-09", to: "2026-03-14", total: 2 });
    expect(result.previous.comparable).toBe(false); // starts before 2026-03-10
    expect(result.delta.events).toBe(result.totals.events - 2);
    const inside = run({ from: "2026-03-16", to: "2026-03-20" });
    expect(inside.previous.comparable).toBe(true);
  });

  it("reports a null percent change rather than dividing by zero", () => {
    const result = run({ from: "2026-03-18", to: "2026-03-20" });
    expect(result.previous.total).toBe(1);
    const empty = buildHistory({
      events: [],
      states: snapshot.states,
      coverage,
      referenceIso: "2026-03-20T12:00:00Z",
      range: { from: "2026-03-18", to: "2026-03-20" },
      scope: NONE,
    });
    expect(empty.delta.percent).toBeNull();
  });

  it("says plainly when the range is partly or fully outside held records", () => {
    const partial = run({ from: "2026-03-01", to: "2026-03-12" });
    expect(partial.coverage.partial).toBe(true);
    expect(partial.coverage.empty).toBe(false);
    expect(partial.coverage.note).toMatch(/unobserved, not quiet/);

    const outside = run({ from: "2025-01-01", to: "2025-01-31" });
    expect(outside.coverage.empty).toBe(true);
    expect(outside.totals.events).toBe(0);

    const none = buildHistory({
      events: [],
      states: snapshot.states,
      coverage: { from: null, to: null, basis: "live_ingestion", label: "none" },
      referenceIso: "2026-03-20T12:00:00Z",
      range: { from: "2026-03-18", to: "2026-03-20" },
      scope: NONE,
    });
    expect(none.coverage.empty).toBe(true);
    expect(none.coverage.note).toMatch(/No records are held/);
  });

  it("marks buckets outside held records as unobserved, never as quiet", () => {
    const result = run({ from: "2026-03-05", to: "2026-03-25" });
    const byStart = new Map(result.series.map((point) => [point.start, point.observed]));
    expect(byStart.get("2026-03-05")).toBe(false);
    expect(byStart.get("2026-03-09")).toBe(false);
    expect(byStart.get("2026-03-10")).toBe(true);
    expect(byStart.get("2026-03-20")).toBe(true);
    expect(byStart.get("2026-03-21")).toBe(false);
    expect(byStart.get("2026-03-25")).toBe(false);
    const none = buildHistory({
      events: [],
      states: snapshot.states,
      coverage: { from: null, to: null, basis: "live_ingestion", label: "none" },
      referenceIso: "2026-03-20T12:00:00Z",
      range: { from: "2026-03-18", to: "2026-03-20" },
      scope: NONE,
    });
    expect(none.series.every((point) => !point.observed)).toBe(true);
  });

  it("uses weekly buckets for a 90-day range and monthly buckets for multi-year ranges", () => {
    const week = run({ from: "2025-12-20", to: "2026-03-20" });
    expect(week.bucket).toBe("week");
    expect(week.series[0]?.start).toBe("2025-12-15"); // a Monday
    const month = run({ from: "2023-01-01", to: "2026-03-20" });
    expect(month.bucket).toBe("month");
    expect(month.series.every((point) => point.start.endsWith("-01"))).toBe(true);
  });
});

describe("history over the demo snapshot", () => {
  it("accounts for every demo event inside the demo coverage", () => {
    const range = resolveHistoryRange({ kind: "window", window: "all" }, snapshot.referenceTime, snapshot.coverage);
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    const result = buildHistory({
      events: snapshot.events,
      states: snapshot.states,
      coverage: snapshot.coverage,
      referenceIso: snapshot.referenceTime,
      range: range.range,
      scope: NONE,
    });
    expect(result.totals.events).toBe(snapshot.events.length);
    expect(result.series.reduce((sum, point) => sum + point.total, 0)).toBe(snapshot.events.length);
    expect(result.coverage.basis).toBe("demo_snapshot");
  });
});

describe("historyQuerySchema", () => {
  it("accepts a window, a from/to pair, or nothing", () => {
    expect(historyQuerySchema.safeParse({}).success).toBe(true);
    expect(historyQuerySchema.safeParse({ window: "30d" }).success).toBe(true);
    expect(historyQuerySchema.safeParse({ from: "2026-01-01", to: "2026-02-01", state: "ng-la" }).success).toBe(true);
  });

  it("rejects half ranges, mixed modes, unknown states and mismatched zone", () => {
    expect(historyQuerySchema.safeParse({ from: "2026-01-01" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ from: "2026-01-01", to: "2026-02-01", window: "7d" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ state: "NG-XX" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ state: "NG-LA", zone: "north-west" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ state: "NG-LA", zone: "south-west" }).success).toBe(true);
  });
});
