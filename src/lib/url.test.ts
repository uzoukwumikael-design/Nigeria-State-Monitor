import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filtersToSearchParams,
  isDefaultFilters,
  resolveInitialView,
  urlForView,
  viewFromNextSearchParams,
  viewFromSearchParams,
} from "@/lib/url";
import { DEFAULT_FILTERS, type Filters } from "@/lib/types";

describe("URL state", () => {
  it("parses valid filters and event deep links", () => {
    const view = viewFromSearchParams(
      new URLSearchParams(
        "state=NG-LA&category=economy&severity=4&verification=corroborated&window=7d&q=flood&event=demo-event-001",
      ),
    );
    expect(view.filters).toEqual({
      category: "economy",
      zone: "all",
      stateId: "NG-LA",
      severity: 4,
      verification: "corroborated",
      window: "7d",
      q: "flood",
    });
    expect(view.eventId).toBe("demo-event-001");
  });

  it("ignores invalid values instead of inventing state", () => {
    const view = viewFromSearchParams(
      new URLSearchParams(
        "state=NG-ZZ&category=nope&severity=9&verification=maybe&window=2d&zone=mars&event=",
      ),
    );
    expect(view.filters.stateId).toBeNull();
    expect(view.filters.category).toBe("all");
    expect(view.filters.severity).toBe("all");
    expect(view.filters.verification).toBe("all");
    expect(view.filters.window).toBe(DEFAULT_FILTERS.window);
    expect(view.filters.zone).toBe("all");
    expect(view.eventId).toBeNull();
  });

  it("drops a zone that conflicts with the selected state", () => {
    const view = viewFromSearchParams(new URLSearchParams("state=NG-LA&zone=north-east"));
    expect(view.filters.stateId).toBe("NG-LA");
    expect(view.filters.zone).toBe("all");
  });

  it("round-trips a full filter set without inventing defaults", () => {
    const filters: Filters = {
      category: "security",
      zone: "south-west",
      stateId: "NG-LA",
      severity: 3,
      verification: "multiple_sources",
      window: "90d",
      q: "road",
    };
    const params = filtersToSearchParams(filters, "demo-event-002");
    const view = viewFromSearchParams(params);
    expect(view.filters).toEqual(filters);
    expect(view.eventId).toBe("demo-event-002");
  });

  it("omits default values from the address bar", () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS, null);
    expect(params.toString()).toBe("");
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    for (const key of ["state", "zone", "category", "severity", "verification", "q"] as const) {
      const filters: Filters = {
        ...DEFAULT_FILTERS,
        ...(key === "state" ? { stateId: "NG-LA" } : {}),
        ...(key === "zone" ? { zone: "north-east" } : {}),
        ...(key === "category" ? { category: "economy" } : {}),
        ...(key === "severity" ? { severity: 2 } : {}),
        ...(key === "verification" ? { verification: "disputed" } : {}),
        ...(key === "q" ? { q: "lagos" } : {}),
      };
      expect(activeFilterCount(filters)).toBe(1);
      expect(isDefaultFilters(filters)).toBe(false);
    }
  });

  it("converts Next searchParams including arrays", () => {
    const view = viewFromNextSearchParams({
      state: ["NG-KN", "NG-LA"],
      window: "24h",
      event: "abc",
    });
    expect(view.filters.stateId).toBe("NG-KN");
    expect(view.filters.window).toBe("24h");
    expect(view.eventId).toBe("abc");
  });

  it("parses and serializes shareable regional profile views", () => {
    const view = viewFromSearchParams(
      new URLSearchParams("view=regions&region=south-west&trend=30&category=economy"),
    );
    expect(view.regionalOpen).toBe(true);
    expect(view.regionalZone).toBe("south-west");
    expect(view.regionalDays).toBe(30);
    expect(view.filters.category).toBe("economy");

    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, category: "economy" },
      null,
      { open: true, zone: "south-west", days: 30 },
    );
    expect(params.get("view")).toBe("regions");
    expect(params.get("region")).toBe("south-west");
    expect(params.get("trend")).toBe("30");
    expect(viewFromSearchParams(params).regionalZone).toBe("south-west");
  });

  it("ignores invalid regional state instead of inventing a profile", () => {
    const view = viewFromSearchParams(
      new URLSearchParams("view=regions&region=mars&trend=999"),
    );
    expect(view.regionalOpen).toBe(true);
    expect(view.regionalZone).toBeNull();
    expect(view.regionalDays).toBe(14);
  });

  it("does not add a regional view to a plain URL", () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS, null, {
      open: false,
      zone: "north-east",
      days: 14,
    });
    expect(params.toString()).toBe("");
  });

  it("serializes a relative URL for sharing", () => {
    expect(urlForView(DEFAULT_FILTERS, null)).toMatch(/^\/?$/);
    expect(urlForView({ ...DEFAULT_FILTERS, stateId: "NG-LA" }, null)).toContain("state=NG-LA");
  });
});

describe("resolveInitialView", () => {
  const serverView = viewFromSearchParams(new URLSearchParams("category=economy"));

  it("keeps the server-rendered view when the address bar has no query", () => {
    expect(resolveInitialView(serverView, "")).toBe(serverView);
    expect(resolveInitialView(serverView, "?")).toBe(serverView);
  });

  it("prefers the address bar so a cached page for another URL cannot override a deep link", () => {
    const view = resolveInitialView(serverView, "?view=regions&region=south-west&trend=30");
    expect(view.regionalOpen).toBe(true);
    expect(view.regionalZone).toBe("south-west");
    expect(view.regionalDays).toBe(30);
    expect(view.filters.category).toBe("all");
  });

  it("accepts a query with or without the leading question mark and ignores junk safely", () => {
    expect(resolveInitialView(serverView, "state=NG-KD").filters.stateId).toBe("NG-KD");
    expect(resolveInitialView(serverView, "?state=NOPE&category=weird").filters.stateId).toBeNull();
  });
});
