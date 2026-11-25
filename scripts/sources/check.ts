import { feedUserAgent, fetchFeed } from "@/lib/ingestion/fetch";
import { fetchGdelt } from "@/lib/ingestion/gdelt";
import { checkRobots } from "@/lib/ingestion/robots";
import { parseRssFeed } from "@/lib/ingestion/rss";
import {
  INGESTION_SOURCES,
  UNVERIFIED_FEED_CANDIDATES,
  probeSourceFor,
  registeredPublisherHosts,
} from "@/lib/ingestion/sources";
import type { IngestionSource } from "@/lib/ingestion/types";

const USAGE = `Nigeria State Monitor — news source health check

Usage:
  npm run sources:check [-- --only=slug,slug] [--candidates] [--json]

Probes each source: reads robots.txt, fetches the RSS feed once, parses it and reports the item count and
newest item. Nothing is stored. Run it from a machine with internet access.

  (default)     the registered, ingestible sources
  --candidates  also probe the UNVERIFIED candidate list (src/lib/ingestion/sources.ts)
  --only=...    limit to these slugs
  --json        machine-readable output

Verdicts: READY (robots permits it and RSS parsed with items) · BLOCKED-ROBOTS (the publisher disallows the feed)
· ROBOTS-UNREADABLE (robots.txt could not be fetched: network or server error, so nothing is fetched) · FEED-ERROR · EMPTY.
Promote a candidate to the registry only when it is READY, and after considering the publisher's terms.`;

type Verdict = "READY" | "BLOCKED-ROBOTS" | "ROBOTS-UNREADABLE" | "FEED-ERROR" | "EMPTY";

interface Row {
  slug: string;
  name: string;
  registered: boolean;
  verdict: Verdict;
  robots: string;
  crawlDelaySeconds: number | null;
  items: number | null;
  newestItem: string | null;
  detail: string;
}

async function probe(source: IngestionSource, registered: boolean): Promise<Row> {
  const base = { slug: source.slug, name: source.name, registered };
  if (source.accessMethod === "gdelt") {
    // An API, not a crawled site: no robots.txt. One request, counting the items that would be kept.
    try {
      const result = await fetchGdelt(source, { excludeHosts: registeredPublisherHosts(), contact: process.env.NSM_INGESTION_CONTACT });
      const times = result.feed.items.map((item) => (item.pubDate ? Date.parse(item.pubDate) : Number.NaN)).filter((value) => !Number.isNaN(value));
      return {
        ...base,
        verdict: result.feed.items.length > 0 ? "READY" : "EMPTY",
        robots: "n/a (API)",
        crawlDelaySeconds: null,
        items: result.feed.items.length,
        newestItem: times.length ? new Date(Math.max(...times)).toISOString() : null,
        detail: `${result.feed.items.length} articles from outlets not read directly`,
      };
    } catch (error) {
      return { ...base, verdict: "FEED-ERROR", robots: "n/a (API)", crawlDelaySeconds: null, items: null, newestItem: null, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  const robots = await checkRobots(source, { userAgent: feedUserAgent(process.env.NSM_INGESTION_CONTACT) });
  const crawlDelaySeconds = robots.crawlDelayMs === null ? null : robots.crawlDelayMs / 1000;
  if (!robots.allowed) {
    return { ...base, verdict: robots.unavailable ? "ROBOTS-UNREADABLE" : "BLOCKED-ROBOTS", robots: robots.reason, crawlDelaySeconds, items: null, newestItem: null, detail: robots.reason };
  }
  try {
    const fetched = await fetchFeed(source);
    const parsed = parseRssFeed(fetched.xml, 100);
    const times = parsed.items
      .map((item) => (item.pubDate ? Date.parse(item.pubDate) : Number.NaN))
      .filter((value) => !Number.isNaN(value));
    const newest = times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
    return {
      ...base,
      verdict: parsed.items.length > 0 ? "READY" : "EMPTY",
      robots: robots.reason,
      crawlDelaySeconds,
      items: parsed.items.length,
      newestItem: newest,
      detail: parsed.items.length > 0 ? `${fetched.contentType}, ${parsed.items.length} items` : "Feed parsed but contained no items.",
    };
  } catch (error) {
    return {
      ...base,
      verdict: "FEED-ERROR",
      robots: robots.reason,
      crawlDelaySeconds,
      items: null,
      newestItem: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const json = args.includes("--json");
  const withCandidates = args.includes("--candidates");
  const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",").map((v) => v.trim()).filter(Boolean);

  const targets: Array<{ source: IngestionSource; registered: boolean }> = [
    ...INGESTION_SOURCES.map((source) => ({ source, registered: true })),
    ...(withCandidates ? UNVERIFIED_FEED_CANDIDATES.map((candidate) => ({ source: probeSourceFor(candidate), registered: false })) : []),
  ].filter(({ source }) => !only || only.includes(source.slug));

  if (targets.length === 0) {
    console.error("No matching sources.");
    process.exitCode = 2;
    return;
  }

  const rows: Row[] = [];
  for (const { source, registered } of targets) {
    rows.push(await probe(source, registered));
  }

  if (json) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2));
    return;
  }
  console.log("Nigeria State Monitor — news source health check\n");
  for (const row of rows) {
    const tag = row.registered ? "registered" : "candidate ";
    console.log(`${row.verdict.padEnd(14)} ${tag} ${row.slug.padEnd(18)} ${row.items === null ? "  -" : String(row.items).padStart(3)} items  newest ${row.newestItem ?? "-"}`);
    if (row.verdict !== "READY") console.log(`               ${row.detail}`);
  }
  const ready = rows.filter((row) => row.verdict === "READY").length;
  console.log(`\n${ready} of ${rows.length} READY.`);
  const readyCandidates = rows.filter((row) => !row.registered && row.verdict === "READY");
  if (readyCandidates.length > 0) {
    console.log(`Candidates that passed (add them to INGESTION_SOURCES after reviewing their terms): ${readyCandidates.map((row) => row.slug).join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error("Source check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
