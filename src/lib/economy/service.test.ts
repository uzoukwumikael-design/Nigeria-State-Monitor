import { beforeEach, describe, expect, it, vi } from "vitest";
import { INDICATORS } from "./indicators";
import {
  FRESH_MS,
  STALE_IF_ERROR_MS,
  clearEconomyCache,
  getEconomySnapshot,
  getIndicatorTrend,
  summariseSeries,
} from "./service";

// TEST FIXTURES ONLY: synthetic values, not Nigerian statistics.
function bodyFor(url: string, values: Array<[string, number | null]>) {
  const code = decodeURIComponent(url.split("/indicator/")[1]!.split("?")[0]!);
  return [
    { page: 1, pages: 1, per_page: 60, total: values.length, lastupdated: "2000-01-02" },
    values.map(([date, value]) => ({
      indicator: { id: code, value: "x" },
      country: { id: "NG", value: "Nigeria" },
      countryiso3code: "NGA",
      date,
      value,
    })),
  ];
}

const OK_VALUES: Array<[string, number | null]> = [
  ["2001", 3],
  ["2000", 1],
  ["2002", null],
];

function okFetch() {
  return vi.fn(async (url: string) => new Response(JSON.stringify(bodyFor(url, OK_VALUES)), { status: 200 }));
}

const BASE = "https://api.worldbank.org/v2";

beforeEach(() => clearEconomyCache());

describe("getEconomySnapshot", () => {
  it("summarises latest, previous and change from published values only", async () => {
    const fetchImpl = okFetch();
    const snapshot = await getEconomySnapshot({ fetchImpl, baseUrl: BASE, nowMs: 1_000 });
    expect(snapshot.indicators).toHaveLength(INDICATORS.length);
    const first = snapshot.indicators[0]!;
    expect(first.latest?.year).toBe(2001);
    expect(first.previous?.year).toBe(2000);
    expect(first.change).toBe(2);
    expect(first.observationCount).toBe(2);
    expect(first.sourceLastUpdated).toBe("2000-01-02");
    expect(snapshot.stale).toBe(false);
    expect(snapshot.source.licence).toBe("CC BY 4.0");
  });

  it("keeps working when one series fails and reports that error", async () => {
    const failing = INDICATORS[1]!.code;
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes(failing)
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify(bodyFor(url, OK_VALUES)), { status: 200 }),
    );
    const snapshot = await getEconomySnapshot({ fetchImpl, baseUrl: BASE, nowMs: 1_000 });
    const broken = snapshot.indicators.find((item) => item.code === failing)!;
    expect(broken.latest).toBeNull();
    expect(broken.error).toMatch(/500/);
    expect(snapshot.indicators.filter((item) => item.latest !== null)).toHaveLength(INDICATORS.length - 1);
  });

  it("serves from cache inside the fresh window without refetching", async () => {
    const fetchImpl = okFetch();
    await getEconomySnapshot({ fetchImpl, baseUrl: BASE, nowMs: 0 });
    const calls = fetchImpl.mock.calls.length;
    await getEconomySnapshot({ fetchImpl, baseUrl: BASE, nowMs: FRESH_MS - 1 });
    expect(fetchImpl.mock.calls.length).toBe(calls);
    await getEconomySnapshot({ fetchImpl, baseUrl: BASE, nowMs: FRESH_MS + 1 });
    expect(fetchImpl.mock.calls.length).toBe(calls * 2);
  });

  it("serves the last good copy flagged stale when a refresh fails, then gives up after a week", async () => {
    await getEconomySnapshot({ fetchImpl: okFetch(), baseUrl: BASE, nowMs: 0 });
    const down = vi.fn(async () => new Response("{}", { status: 503 }));

    const stale = await getEconomySnapshot({ fetchImpl: down, baseUrl: BASE, nowMs: FRESH_MS + 1 });
    expect(stale.stale).toBe(true);
    expect(stale.indicators[0]?.latest?.year).toBe(2001);
    expect(stale.indicators[0]?.error).toMatch(/503/);

    const expired = await getEconomySnapshot({ fetchImpl: down, baseUrl: BASE, nowMs: STALE_IF_ERROR_MS + 1 });
    expect(expired.indicators[0]?.latest).toBeNull();
    expect(expired.stale).toBe(false);
  });
});

describe("getIndicatorTrend", () => {
  it("returns the full series or an error, never made-up points", async () => {
    const code = INDICATORS[0]!.code;
    const ok = await getIndicatorTrend(code, { fetchImpl: okFetch(), baseUrl: BASE, nowMs: 0 });
    expect(ok.series?.observations.map((item) => item.year)).toEqual([2000, 2001]);

    clearEconomyCache();
    const down = await getIndicatorTrend(code, {
      fetchImpl: async () => new Response("{}", { status: 500 }),
      baseUrl: BASE,
      nowMs: 0,
    });
    expect(down.series).toBeNull();
    expect(down.error).toMatch(/500/);
  });
});

describe("summariseSeries", () => {
  it("has no change when only one observation exists", () => {
    const definition = INDICATORS[0]!;
    const summary = summariseSeries({
      definition,
      observations: [{ year: 2000, value: 1, referencePeriodStart: "2000-01-01", referencePeriodEnd: "2000-12-31" }],
      sourceLastUpdated: null,
      retrievedAt: new Date(0).toISOString(),
    });
    expect(summary.change).toBeNull();
    expect(summary.previous).toBeNull();
  });
});
