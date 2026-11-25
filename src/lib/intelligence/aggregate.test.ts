import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import {
  allStateStats,
  categoryBreakdown,
  countByCategory,
  getStateStats,
  nationalSummary,
  severityBreakdown,
  sourceDistribution,
  topStates,
  trendSeries,
  zoneSummaries,
} from "@/lib/intelligence/aggregate";
import { STATE_BY_ID, STATES, statesInZone } from "@/lib/geo/states";
import { DEFAULT_FILTERS, type Filters } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const events = snapshot.events;
const reference = DEMO_REFERENCE_TIME;
const filters: Filters = { ...DEFAULT_FILTERS };

describe("intelligence aggregation", () => {
  it("counts categories and severities exactly once per event", () => {
    const categories = countByCategory(events);
    expect(Object.values(categories).reduce((sum, count) => sum + count, 0)).toBe(events.length);
    const categoryRows = categoryBreakdown(events);
    expect(categoryRows).toHaveLength(6);
    expect(categoryRows.reduce((sum, row) => sum + row.count, 0)).toBe(events.length);
    expect(categoryRows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 6);

    const severityRows = severityBreakdown(events);
    expect(severityRows).toHaveLength(5);
    expect(severityRows.reduce((sum, row) => sum + row.count, 0)).toBe(events.length);
  });

  it("derives state stats from the same event set", () => {
    const lagos = STATE_BY_ID.get("NG-LA");
    expect(lagos).toBeDefined();
    if (!lagos) return;
    const stats = getStateStats(events, lagos, reference);
    const lagosEvents = events.filter((event) => event.stateId === "NG-LA");
    expect(stats.reportedEvents).toBe(lagosEvents.length);
    expect(stats.stateId).toBe("NG-LA");
    expect(Object.values(stats.categories).reduce((sum, count) => sum + count, 0)).toBe(
      lagosEvents.length,
    );
    expect(stats.critical).toBe(lagosEvents.filter((event) => event.severity === 5).length);

    const all = allStateStats(events, STATES, reference);
    expect(Object.keys(all)).toHaveLength(37);
    expect(Object.values(all).reduce((sum, state) => sum + state.reportedEvents, 0)).toBe(
      events.filter((event) => event.stateId).length,
    );
  });

  it("builds a national summary that matches direct counts", () => {
    const summary = nationalSummary(events, filters, reference);
    expect(summary.totals.reportedEvents).toBe(events.length);
    expect(summary.totals.statesWithReports).toBe(37);
    expect(summary.categories.reduce((sum, row) => sum + row.count, 0)).toBe(events.length);
    expect(summary.zones).toHaveLength(6);
    expect(summary.topStates.length).toBeLessThanOrEqual(7);
    const firstTop = summary.topStates[0];
    const lastTop = summary.topStates.at(-1);
    expect(firstTop).toBeDefined();
    expect(lastTop).toBeDefined();
    expect(firstTop!.count).toBeGreaterThanOrEqual(lastTop!.count);
    expect(summary.assessment).toContain("fictional demo");
    expect(summary.assessment).toContain("not incidence, danger or a state safety ranking");
  });

  it("groups all zoned events into exactly six zones", () => {
    const zones = zoneSummaries(events, reference);
    expect(zones).toHaveLength(6);
    expect(new Set(zones.map((zone) => zone.zone)).size).toBe(6);
    const zoned = events.filter((event) => event.zone !== null);
    expect(zones.reduce((sum, zone) => sum + zone.reportedEvents, 0)).toBe(zoned.length);
    expect(zones.reduce((sum, zone) => sum + zone.share, 0)).toBeCloseTo(1, 6);
    for (const zone of zones) {
      expect(zone.statesReporting).toBeLessThanOrEqual(statesInZone(zone.zone).length);
      expect(zone.statesReporting).toBeGreaterThanOrEqual(1);
    }
  });

  it("builds 14 ordered daily trend buckets with consistent totals", () => {
    const series = trendSeries(events, reference, 14);
    expect(series).toHaveLength(14);
    expect(new Set(series.map((point) => point.day)).size).toBe(14);
    for (const point of series) {
      const categoryTotal = Object.values(point.byCategory).reduce((sum, count) => sum + count, 0);
      expect(categoryTotal).toBe(point.total);
      expect(point.severity4Plus).toBeLessThanOrEqual(point.total);
      expect(point.critical).toBeLessThanOrEqual(point.severity4Plus);
    }
    const total = series.reduce((sum, point) => sum + point.total, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(events.length);
  });

  it("reports source groups without exceeding event counts", () => {
    const distribution = sourceDistribution(events);
    expect(distribution.length).toBeGreaterThan(0);
    for (const source of distribution) {
      expect(source.isDemo).toBe(true);
      expect(source.count).toBeGreaterThan(0);
      expect(source.share).toBeGreaterThan(0);
      expect(source.share).toBeLessThanOrEqual(1);
    }
    expect(topStates(events, STATES, 3)).toHaveLength(3);
  });
});
