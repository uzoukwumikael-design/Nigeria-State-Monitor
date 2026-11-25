import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { filterEvents } from "@/lib/intelligence/filter";
import {
  buildRegionalIntelligence,
  zoneComparisons,
  zoneProfile,
} from "@/lib/intelligence/regional";
import { DEFAULT_FILTERS, type Filters } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const events = snapshot.events;
const reference = DEMO_REFERENCE_TIME;
const filters: Filters = { ...DEFAULT_FILTERS };

describe("regional intelligence", () => {
  it("builds six like-for-like zone comparisons from zoned events", () => {
    const comparisons = zoneComparisons(events, reference, 14);
    const zoned = events.filter((event) => event.zone !== null);
    expect(comparisons).toHaveLength(6);
    expect(new Set(comparisons.map((zone) => zone.zone)).size).toBe(6);
    expect(comparisons.reduce((sum, zone) => sum + zone.reportedEvents, 0)).toBe(zoned.length);
    expect(comparisons.reduce((sum, zone) => sum + zone.share, 0)).toBeCloseTo(1, 6);

    for (const zone of comparisons) {
      expect(zone.statesTotal).toBeGreaterThanOrEqual(5);
      expect(zone.statesReporting).toBeLessThanOrEqual(zone.statesTotal);
      expect(zone.severity4Plus).toBeLessThanOrEqual(zone.reportedEvents);
      expect(zone.corroborated).toBeLessThanOrEqual(zone.reportedEvents);
      expect(zone.singleSource).toBeLessThanOrEqual(zone.reportedEvents);
      expect(zone.trend).toHaveLength(14);
      expect(zone.trendTotal).toBeLessThanOrEqual(zone.reportedEvents);
      expect(zone.activeDays).toBeLessThanOrEqual(14);
      expect(zone.trendTotal).toBe(zone.trend.reduce((sum, point) => sum + point.total, 0));
    }
  });

  it("builds a complete selected-zone profile with consistent denominators", () => {
    const profile = zoneProfile(events, "south-west", reference, 14);
    const zoneEvents = events.filter((event) => event.zone === "south-west");
    expect(profile.zone).toBe("south-west");
    expect(profile.totals.reportedEvents).toBe(zoneEvents.length);
    expect(profile.categories.reduce((sum, row) => sum + row.count, 0)).toBe(zoneEvents.length);
    expect(profile.severity.reduce((sum, row) => sum + row.count, 0)).toBe(zoneEvents.length);
    expect(profile.verification.reduce((sum, row) => sum + row.count, 0)).toBe(zoneEvents.length);
    expect(profile.states.reduce((sum, row) => sum + row.count, 0)).toBe(zoneEvents.length);
    expect(profile.states).toHaveLength(6);
    expect(profile.topStates.length).toBeLessThanOrEqual(3);
    expect(profile.recentEvents.length).toBeLessThanOrEqual(5);
    expect(profile.trend).toHaveLength(14);
    expect(profile.assessment).toContain("fictional demo");
    expect(profile.assessment).toContain("not incidence, danger or a state safety ranking");
    expect(profile.comparison.highSeverityShare).toBeGreaterThanOrEqual(0);
    expect(profile.comparison.highSeverityShare).toBeLessThanOrEqual(1);
    expect(profile.comparison.nationalHighSeverityShare).toBeGreaterThanOrEqual(0);
    expect(profile.comparison.stateCoverageShare).toBeGreaterThan(0);
    expect(profile.totals.independentSourceGroups).toBeGreaterThan(0);
    expect(profile.sources.every((source) => source.isDemo)).toBe(true);
    expect(profile.limitations.length).toBeGreaterThan(0);
  });

  it("returns an explicit empty profile instead of inventing activity", () => {
    const profile = zoneProfile([], "north-east", reference, 14);
    expect(profile.totals.reportedEvents).toBe(0);
    expect(profile.categories.every((row) => row.count === 0)).toBe(true);
    expect(profile.trend.every((point) => point.total === 0)).toBe(true);
    expect(profile.states.every((state) => state.count === 0)).toBe(true);
    expect(profile.assessment).toContain("No fictional demo events");
    expect(profile.assessment).toContain("not evidence of safety");
  });

  it("composes the regional response and respects active filters", () => {
    const filtered = filterEvents(events, { ...filters, category: "security" }, reference);
    const payload = buildRegionalIntelligence(
      filtered,
      { ...filters, category: "security" },
      reference,
      "north-east",
      30,
    );
    expect(payload.zones).toHaveLength(6);
    expect(payload.selected?.zone).toBe("north-east");
    expect(payload.selectedLabel).toBe("North East");
    expect(payload.days).toBe(30);
    expect(payload.volumeIsRisk).toBe(false);
    expect(payload.assessmentKind).toBe("automated_demo_summary");
    expect(payload.selected?.trend).toHaveLength(30);
    expect(payload.zonalTotal).toBe(
      payload.zones.reduce((sum, zone) => sum + zone.reportedEvents, 0),
    );
    expect(payload.limitations.length).toBeGreaterThan(0);

    const withoutSelection = buildRegionalIntelligence(filtered, filters, reference, null, 14);
    expect(withoutSelection.selected).toBeNull();
    expect(withoutSelection.assessment).toContain("reported demo volume");
    expect(withoutSelection.assessment).toContain("not incidence");
  });
});
