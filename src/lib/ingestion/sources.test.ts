import { describe, expect, it } from "vitest";
import {
  INGESTION_SOURCES,
  SOURCE_EVIDENCE,
  UNVERIFIED_FEED_CANDIDATES,
  disabledSourceSlugs,
  ingestionSource,
  selectIngestionSources,
} from "./sources";

describe("ingestion source registry", () => {
  it("registers 31 active, restricted, HTTPS-only sources (22 publisher feeds, the NiMet alert feed and 8 GDELT queries), starting with the seven author-verified ones", () => {
    const slugs = INGESTION_SOURCES.map((source) => source.slug);
    expect(slugs).toHaveLength(31);
    expect(slugs.slice(0, 7)).toEqual([
      "premium-times",
      "channels-tv",
      "punch",
      "vanguard",
      "daily-trust",
      "businessday",
      "nigerian-tribune",
    ]);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const source of INGESTION_SOURCES) {
      expect(source.active).toBe(true);
      expect(source.licenceStatus).toBe("restricted");
      expect(source.feedUrl.startsWith("https://")).toBe(true);
      expect(source.allowedHosts).toContain(new URL(source.feedUrl).hostname);
      expect(source.allowedHosts).toContain(new URL(source.baseUrl).hostname);
      expect(source.crawlDelayMs).toBeGreaterThanOrEqual(10_000);
    }
  });

  it("labels the evidence for every registered source and nothing else", () => {
    const slugs = INGESTION_SOURCES.map((source) => source.slug).sort();
    expect(Object.keys(SOURCE_EVIDENCE).sort()).toEqual(slugs);
    const verified = Object.entries(SOURCE_EVIDENCE).filter(([, value]) => value.level === "verified");
    expect(verified.map(([slug]) => slug)).toHaveLength(7);
    for (const entry of Object.values(SOURCE_EVIDENCE)) expect(entry.note.length).toBeGreaterThan(5);
  });

  it("registers eight GDELT queries (national, foreign and one per zone) as one independence group with the aggregator link policy", () => {
    const gdelt = INGESTION_SOURCES.filter((source) => source.accessMethod === "gdelt");
    expect(gdelt.map((source) => source.slug).sort()).toEqual(
      ["gdelt-international", "gdelt-nigeria", "gdelt-north-central", "gdelt-north-east", "gdelt-north-west", "gdelt-south-east", "gdelt-south-south", "gdelt-south-west"],
    );
    for (const source of gdelt) {
      expect(source).toMatchObject({ tier: "aggregator", sourceType: "aggregator", linkPolicy: "any_public_https", independenceGroup: "gdelt", maxItems: 250 });
      const url = new URL(source.feedUrl);
      expect(url.hostname).toBe("api.gdeltproject.org");
      expect(url.searchParams.get("maxrecords")).toBe("250");
    }
    expect(ingestionSource("punch")?.linkPolicy).toBeUndefined();
  });

  it("builds each zone query from that zone's states, quoting multi-word names and using Abuja for the FCT", () => {
    const query = (slug: string) => new URL(ingestionSource(slug)!.feedUrl).searchParams.get("query")!;
    expect(query("gdelt-south-south")).toContain('"Akwa Ibom"');
    expect(query("gdelt-south-south")).toContain('"Cross River"');
    expect(query("gdelt-north-central")).toContain("Abuja");
    expect(query("gdelt-north-central")).not.toContain("Federal Capital Territory");
    expect(query("gdelt-south-west")).toMatch(/Lagos OR Ogun/);
    expect(query("gdelt-south-west")).not.toContain("Kano");
    expect(query("gdelt-international")).toContain("-sourcecountry:NI");
  });

  it("registers NiMet's official alert feed as an official source on its own host", () => {
    const nimet = ingestionSource("nimet-alerts");
    expect(nimet).toMatchObject({ tier: "official", sourceType: "official", licenceStatus: "restricted" });
    expect(nimet?.feedUrl).toBe("https://cap-sources.s3.amazonaws.com/ng-nimet-en/rss.xml");
    expect(nimet?.allowedHosts).toContain("cap-sources.s3.amazonaws.com");
  });

  it("marks regional outlets with the regional tier", () => {
    expect(ingestionSource("the-tide")?.tier).toBe("regional_publisher");
    expect(ingestionSource("punch")?.tier).toBe("major_publisher");
  });

  it("gives every publisher its own independence group, while all GDELT queries share a single one", () => {
    const direct = INGESTION_SOURCES.filter((source) => source.accessMethod === "rss");
    const groups = direct.map((source) => source.independenceGroup);
    expect(new Set(groups).size).toBe(groups.length);
    const aggregator = INGESTION_SOURCES.filter((source) => source.accessMethod === "gdelt");
    expect(new Set(aggregator.map((source) => source.independenceGroup))).toEqual(new Set(["gdelt"]));
    expect(groups).not.toContain("gdelt");
  });

  it("uses the documented feed URLs", () => {
    expect(ingestionSource("punch")?.feedUrl).toBe("https://punchng.com/feed/");
    expect(ingestionSource("vanguard")?.feedUrl).toBe("https://www.vanguardngr.com/feed/");
    expect(ingestionSource("daily-trust")?.feedUrl).toBe("https://dailytrust.com/feed/");
  });

  it("keeps unverified candidates out of the ingestible registry", () => {
    expect(UNVERIFIED_FEED_CANDIDATES.length).toBeGreaterThan(15);
    expect(new Set(UNVERIFIED_FEED_CANDIDATES.map((candidate) => candidate.slug)).size).toBe(UNVERIFIED_FEED_CANDIDATES.length);
    for (const candidate of UNVERIFIED_FEED_CANDIDATES) {
      expect(ingestionSource(candidate.slug)).toBeNull();
      expect(candidate.feedUrl.startsWith("https://")).toBe(true);
    }
  });
});

describe("selectIngestionSources", () => {
  it("selects all active sources, a comma list, and de-duplicates", () => {
    expect(selectIngestionSources("all")).toHaveLength(31);
    expect(selectIngestionSources("punch, vanguard ,punch").map((source) => source.slug)).toEqual(["punch", "vanguard"]);
  });

  it("honours INGESTION_DISABLE for 'all' and refuses an explicitly requested disabled source", () => {
    const env = { INGESTION_DISABLE: "punch, Vanguard" };
    const all = selectIngestionSources("all", env).map((source) => source.slug);
    expect(all).not.toContain("punch");
    expect(all).not.toContain("vanguard");
    expect(all).toHaveLength(29);
    expect(() => selectIngestionSources("punch", env)).toThrow(/disabled by INGESTION_DISABLE/);
    expect(selectIngestionSources("daily-post", env).map((source) => source.slug)).toEqual(["daily-post"]);
    expect(disabledSourceSlugs({})).toEqual(new Set());
  });

  it("fails loudly on unknown slugs, including unverified candidates, and on empty input", () => {
    expect(() => selectIngestionSources("not-a-source")).toThrow(/Unknown ingestion source/);
    expect(() => selectIngestionSources("the-nation")).toThrow(/Unknown ingestion source/);
    expect(() => selectIngestionSources(" , ")).toThrow(/No ingestion source/);
  });
});
