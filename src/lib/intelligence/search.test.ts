import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { searchSnapshot } from "@/lib/intelligence/search";

const snapshot = buildDemoSnapshot();

describe("search", () => {
  it("returns nothing for one-character or blank queries", () => {
    expect(searchSnapshot("", snapshot.events, DEMO_REFERENCE_TIME)).toEqual({
      states: [],
      events: [],
      categories: [],
      zones: [],
    });
    expect(searchSnapshot("a", snapshot.events, DEMO_REFERENCE_TIME).states).toHaveLength(0);
  });

  it("finds states by name, capital, alias and ID", () => {
    for (const query of ["Lagos", "Ikeja", "NG-LA", "Abuja", "FCT"]) {
      const results = searchSnapshot(query, snapshot.events, DEMO_REFERENCE_TIME);
      expect(results.states.some((hit) => hit.id === "NG-FC" || hit.id === "NG-LA")).toBe(true);
    }
  });

  it("finds geopolitical zones", () => {
    const results = searchSnapshot("North East", snapshot.events, DEMO_REFERENCE_TIME);
    expect(results.zones.some((hit) => hit.id === "north-east")).toBe(true);
  });

  it("finds categories and events", () => {
    const category = searchSnapshot("security", snapshot.events, DEMO_REFERENCE_TIME);
    expect(category.categories.some((hit) => hit.id === "security")).toBe(true);

    const target = snapshot.events.find((event) => event.stateId === "NG-LA") ?? snapshot.events[0]!;
    const query = target.title.split(" ").slice(0, 3).join(" ");
    const results = searchSnapshot(query, snapshot.events, DEMO_REFERENCE_TIME, 50);
    expect(results.events.some((hit) => hit.id === target.id)).toBe(true);
  });

  it("caps result groups", () => {
    const results = searchSnapshot("a", snapshot.events, DEMO_REFERENCE_TIME);
    expect(results.events.length).toBeLessThanOrEqual(12);
    expect(searchSnapshot("lagos", snapshot.events, DEMO_REFERENCE_TIME).states.length).toBeLessThanOrEqual(6);
  });

  it("returns no results for an unknown term", () => {
    const results = searchSnapshot("zzzz-not-a-place", snapshot.events, DEMO_REFERENCE_TIME);
    expect(results.states).toHaveLength(0);
    expect(results.events).toHaveLength(0);
    expect(results.categories).toHaveLength(0);
    expect(results.zones).toHaveLength(0);
  });
});
