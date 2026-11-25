import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import {
  eventTimestamp,
  filterEvents,
  previousPeriodEvents,
  windowStart,
} from "@/lib/intelligence/filter";
import { DEFAULT_FILTERS, type Filters } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const events = snapshot.events;
const reference = DEMO_REFERENCE_TIME;

function filters(patch: Partial<Filters> = {}): Filters {
  return { ...DEFAULT_FILTERS, ...patch };
}

describe("event filtering", () => {
  it("applies the default 30-day window using occurrence time", () => {
    const result = filterEvents(events, filters(), reference);
    const start = new Date(reference).getTime() - 30 * 86_400_000;
    expect(result.length).toBeGreaterThan(0);
    for (const event of result) expect(eventTimestamp(event)).toBeGreaterThanOrEqual(start);
    expect(result.length).toBeLessThanOrEqual(events.length);
  });

  it("filters by state, zone, category, severity and verification", () => {
    const byState = filterEvents(events, filters({ stateId: "NG-LA" }), reference);
    expect(byState.length).toBeGreaterThan(0);
    expect(byState.every((event) => event.stateId === "NG-LA")).toBe(true);

    const byZone = filterEvents(events, filters({ zone: "north-east" }), reference);
    expect(byZone.length).toBeGreaterThan(0);
    expect(byZone.every((event) => event.zone === "north-east")).toBe(true);

    const byCategory = filterEvents(events, filters({ category: "economy" }), reference);
    expect(byCategory.length).toBeGreaterThan(0);
    expect(byCategory.every((event) => event.category === "economy")).toBe(true);

    const bySeverity = filterEvents(events, filters({ severity: 4 }), reference);
    expect(bySeverity.every((event) => event.severity === 4)).toBe(true);

    const byVerification = filterEvents(
      events,
      filters({ verification: "disputed" }),
      reference,
    );
    expect(byVerification.every((event) => event.verificationStatus === "disputed")).toBe(true);
  });

  it("matches multi-token search across title, place and source fields", () => {
    const target = events[0]!;
    const token = target.title.split(" ")[0];
    const result = filterEvents(events, filters({ q: token }), "all");
    expect(result.some((event) => event.id === target.id)).toBe(true);

    const none = filterEvents(events, filters({ q: "zzzz-no-such-record" }), "all");
    expect(none).toHaveLength(0);
  });

  it("returns events sorted by latest update", () => {
    const result = filterEvents(events, filters({ window: "all" }), reference);
    for (let index = 1; index < result.length; index += 1) {
      const previous = result[index - 1]!;
      const current = result[index]!;
      expect(previous.lastUpdatedAt >= current.lastUpdatedAt).toBe(true);
    }
  });

  it("computes previous-period bounds without overlap", () => {
    expect(windowStart("all", reference)).toBeNull();
    expect(windowStart("7d", reference)).toBe(new Date(reference).getTime() - 7 * 86_400_000);

    const previous = previousPeriodEvents(events, filters({ window: "30d" }), reference);
    const duration = 30 * 86_400_000;
    const end = new Date(reference).getTime() - duration;
    const start = end - duration;
    for (const event of previous) {
      const timestamp = eventTimestamp(event);
      expect(timestamp).toBeGreaterThanOrEqual(start);
      expect(timestamp).toBeLessThan(end);
    }
    expect(previousPeriodEvents(events, filters({ window: "all" }), reference)).toEqual([]);
  });
});
