import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { CATEGORY_IDS, SEVERITIES, VERIFICATION_STATUSES } from "@/lib/types";

describe("demo snapshot invariants", () => {
  const snapshot = buildDemoSnapshot();

  it("is explicitly and consistently fictional", () => {
    expect(snapshot.mode).toBe("demo");
    expect(snapshot.referenceTime).toBe(DEMO_REFERENCE_TIME);
    expect(snapshot.disclaimer).toBe("DEMO DATA — NOT A REAL INCIDENT");
    expect(snapshot.events.length).toBe(74);
    expect(snapshot.events.every((event) => event.isDemo)).toBe(true);
    expect(snapshot.sources.every((source) => source.isDemo)).toBe(true);
    for (const event of snapshot.events) {
      expect(event.sources.length).toBeGreaterThan(0);
      expect(event.sources.every((source) => source.isDemo)).toBe(true);
      expect(event.sources.every((source) => source.url === null)).toBe(true);
      expect(event.analysisKind).toBe("automated_demo_summary");
    }
  });

  it("covers all 37 first-order units and all six categories", () => {
    const stateIds = new Set(snapshot.events.map((event) => event.stateId).filter(Boolean));
    expect(stateIds.size).toBe(37);
    const categories = new Set(snapshot.events.map((event) => event.category));
    expect(categories).toEqual(new Set(CATEGORY_IDS));
    const severities = new Set(snapshot.events.map((event) => event.severity));
    expect(severities.has(4)).toBe(true);
    for (const severity of severities) expect(SEVERITIES).toContain(severity);
    expect(snapshot.events.filter((event) => event.severity === 5)).toHaveLength(0);
    const statuses = new Set(snapshot.events.map((event) => event.verificationStatus));
    for (const status of ["unassessed", "single_source", "corroborated", "disputed"] as const) {
      expect(statuses.has(status)).toBe(true);
    }
    for (const status of statuses) expect(VERIFICATION_STATUSES).toContain(status);
  });

  it("only places points where a location basis exists", () => {
    for (const event of snapshot.events) {
      expect(["exact", "lga", "state", "national", "unknown"]).toContain(event.geoPrecision);
      if (event.coordinates) {
        expect(["exact", "lga", "state"]).toContain(event.geoPrecision);
        expect(event.coordinates.lng).toBeGreaterThan(2.5);
        expect(event.coordinates.lng).toBeLessThan(15);
        expect(event.coordinates.lat).toBeGreaterThan(4);
        expect(event.coordinates.lat).toBeLessThan(14.2);
        expect(event.geoConfidence).toBeGreaterThanOrEqual(0);
        expect(event.geoConfidence).toBeLessThanOrEqual(1);
      } else {
        expect(["national", "unknown"]).toContain(event.geoPrecision);
      }
    }
  });

  it("never claims more independent groups than article copies", () => {
    for (const event of snapshot.events) {
      expect(event.articleCount).toBeGreaterThanOrEqual(1);
      expect(event.independentSourceCount).toBeGreaterThanOrEqual(1);
      expect(event.independentSourceCount).toBeLessThanOrEqual(event.articleCount);
      expect(event.articleCount).toBeGreaterThanOrEqual(event.sources.length);
      expect(event.confidence).toBeGreaterThanOrEqual(0);
      expect(event.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across builds", () => {
    const again = buildDemoSnapshot();
    expect(again.events.map((event) => event.id)).toEqual(snapshot.events.map((event) => event.id));
    expect(again.generatedAt).toBe(snapshot.generatedAt);
    expect(again.datasetVersion).toBe(snapshot.datasetVersion);
  });
});
