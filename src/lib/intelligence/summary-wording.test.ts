import { describe, expect, it } from "vitest";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { nationalSummary } from "@/lib/intelligence/aggregate";
import { buildRegionalIntelligence, regionalLimitations } from "@/lib/intelligence/regional";
import { DEFAULT_FILTERS } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const filters = { ...DEFAULT_FILTERS, window: "all" as const };

describe("generated summary wording follows the dataset mode", () => {
  it("keeps the fictional wording for the demo snapshot (the default)", () => {
    const text = nationalSummary(snapshot.events, filters, DEMO_REFERENCE_TIME).assessment;
    expect(text).toMatch(/fictional demo events are in view/);
    expect(text).toMatch(/static fictional dataset/);
    expect(text).toMatch(/single independent demo source group/);
  });

  it("never calls real published records demo or fictional, including for empty results", () => {
    const real = snapshot.events.map((event) => ({ ...event, isDemo: false }));
    const withData = nationalSummary(real, filters, DEMO_REFERENCE_TIME, "production").assessment;
    const empty = nationalSummary([], filters, DEMO_REFERENCE_TIME, "production").assessment;
    for (const text of [withData, empty]) expect(text).not.toMatch(/demo|fictional/i);
    expect(withData).toMatch(/published reports/);
  });

  it("applies the same rule to zone assessments", () => {
    const real = snapshot.events.map((event) => ({ ...event, isDemo: false }));
    const regional = buildRegionalIntelligence(real, filters, DEMO_REFERENCE_TIME, "south-west", 30, "production");
    expect(regional.selected?.assessment).not.toMatch(/demo|fictional/i);
    expect(regional.assessment).not.toMatch(/demo|fictional/i);
    const none = buildRegionalIntelligence([], filters, DEMO_REFERENCE_TIME, "south-west", 30, "production");
    expect(none.selected?.assessment).not.toMatch(/demo|fictional/i);
  });

  it("keeps the all-zone comparison text and the limitations list free of demo wording in production", () => {
    const real = snapshot.events.map((event) => ({ ...event, isDemo: false }));
    for (const events of [real, []]) {
      const regional = buildRegionalIntelligence(events, filters, DEMO_REFERENCE_TIME, null, 30, "production");
      expect(regional.assessment).not.toMatch(/demo|fictional/i);
      expect(regional.limitations.join(" ")).not.toMatch(/demo|fictional/i);
    }
    expect(regionalLimitations("demo").join(" ")).toMatch(/fictional demo content/);
  });
});
