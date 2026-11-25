import { describe, expect, it, vi } from "vitest";
import {
  EconomySourceError,
  fetchWorldBankSeries,
  parseWorldBankSeries,
  resolveWorldBankBaseUrl,
} from "./worldbank";

// TEST FIXTURES ONLY. Values are synthetic placeholders (1.0, 2.0 …) shaped like the
// World Bank v2 response; they are not Nigerian statistics.
const CODE = "NY.GDP.MKTP.KD.ZG";

function row(year: string, value: number | null, code = CODE, iso3 = "NGA") {
  return {
    indicator: { id: code, value: "x" },
    country: { id: "NG", value: "Nigeria" },
    countryiso3code: iso3,
    date: year,
    value,
    unit: "",
    obs_status: "",
    decimal: 1,
  };
}

function payload(rows: unknown[] | null, extra: Record<string, unknown> = {}) {
  return [
    { page: 1, pages: 1, per_page: 60, total: rows?.length ?? 0, lastupdated: "2000-01-02", ...extra },
    rows,
  ];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("parseWorldBankSeries", () => {
  it("returns observations oldest first with explicit reference periods", () => {
    const series = parseWorldBankSeries(CODE, payload([row("2002", 2), row("2000", 1), row("2001", 1.5)]));
    expect(series.observations.map((item) => item.year)).toEqual([2000, 2001, 2002]);
    expect(series.observations[0]).toMatchObject({
      value: 1,
      referencePeriodStart: "2000-01-01",
      referencePeriodEnd: "2000-12-31",
    });
    expect(series.sourceLastUpdated).toBe("2000-01-02");
    expect(series.definition.code).toBe(CODE);
  });

  it("drops years without a published value instead of filling them", () => {
    const series = parseWorldBankSeries(CODE, payload([row("2001", null), row("2000", 1)]));
    expect(series.observations).toHaveLength(1);
    expect(series.observations[0]?.year).toBe(2000);
  });

  it("treats [meta, null] with total 0 as an empty series", () => {
    const series = parseWorldBankSeries(CODE, payload(null, { total: 0 }));
    expect(series.observations).toEqual([]);
  });

  it("rejects the API's error envelope", () => {
    const envelope = [{ message: [{ id: "175", key: "Invalid format", value: "bad" }] }];
    expect(() => parseWorldBankSeries(CODE, envelope)).toThrow(EconomySourceError);
  });

  it("rejects a response for a different series", () => {
    expect(() => parseWorldBankSeries(CODE, payload([row("2000", 1, "FP.CPI.TOTL.ZG")]))).toThrow(
      /returned series/,
    );
  });

  it("rejects data for another country", () => {
    expect(() => parseWorldBankSeries(CODE, payload([row("2000", 1, CODE, "GHA")]))).toThrow(/not Nigeria/);
  });

  it("rejects malformed observations and non-year dates", () => {
    expect(() => parseWorldBankSeries(CODE, payload([row("2000Q1", 1)]))).toThrow(EconomySourceError);
    expect(() => parseWorldBankSeries(CODE, payload([{ nope: true }]))).toThrow(EconomySourceError);
  });

  it("rejects unknown indicator codes", () => {
    expect(() => parseWorldBankSeries("NOT.A.CODE", payload([]))).toThrow(/Unknown indicator/);
  });

  it("ignores an unrecognised lastupdated format rather than guessing", () => {
    const series = parseWorldBankSeries(CODE, payload([row("2000", 1)], { lastupdated: "yesterday" }));
    expect(series.sourceLastUpdated).toBeNull();
  });
});

describe("resolveWorldBankBaseUrl", () => {
  it("defaults to the official host", () => {
    expect(resolveWorldBankBaseUrl(undefined)).toBe("https://api.worldbank.org/v2");
  });

  it("refuses other hosts, plain http and embedded credentials", () => {
    expect(() => resolveWorldBankBaseUrl("https://example.com/v2")).toThrow(/not permitted/);
    expect(() => resolveWorldBankBaseUrl("http://api.worldbank.org/v2")).toThrow(/not permitted/);
    expect(() => resolveWorldBankBaseUrl("https://user:pw@api.worldbank.org/v2")).toThrow(/not permitted/);
    expect(() => resolveWorldBankBaseUrl("not a url")).toThrow(/absolute HTTPS URL/);
  });
});

describe("fetchWorldBankSeries", () => {
  it("requests the Nigeria series from the allow-listed host without following redirects", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload([row("2000", 1)])));
    const series = await fetchWorldBankSeries(CODE, { fetchImpl, baseUrl: "https://api.worldbank.org/v2" });
    expect(series.observations).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.worldbank.org/v2/country/NGA/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=60",
    );
    expect(init.redirect).toBe("error");
  });

  it("classifies HTTP, network and format failures", async () => {
    const base = "https://api.worldbank.org/v2";
    await expect(
      fetchWorldBankSeries(CODE, { fetchImpl: async () => jsonResponse({}, 503), baseUrl: base }),
    ).rejects.toMatchObject({ kind: "http" });
    await expect(
      fetchWorldBankSeries(CODE, {
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
        baseUrl: base,
      }),
    ).rejects.toMatchObject({ kind: "network" });
    await expect(
      fetchWorldBankSeries(CODE, { fetchImpl: async () => new Response("<html>", { status: 200 }), baseUrl: base }),
    ).rejects.toMatchObject({ kind: "format" });
  });

  it("refuses to fetch an unknown indicator", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchWorldBankSeries("X.Y", { fetchImpl, baseUrl: "https://api.worldbank.org/v2" })).rejects.toMatchObject({
      kind: "unknown_indicator",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
