import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FALLBACK_FEED_PATHS, findFeedLinks, nameFromHost, normaliseSiteUrl, slugFromHost } from "@/lib/ingestion/discover";
import { feedUserAgent, fetchFeed } from "@/lib/ingestion/fetch";
import { checkRobots } from "@/lib/ingestion/robots";
import { parseRssFeed } from "@/lib/ingestion/rss";
import { INGESTION_SOURCES, buildExtraSources, probeSourceFor, type ExtraSourceEntry } from "@/lib/ingestion/sources";

const FILE = path.join(process.cwd(), "src/config/extra-sources.json");

const USAGE = `Nigeria State Monitor — add a news site

Usage:
  npm run sources:add -- <site> [--name="Site Name"] [--slug=site] [--tier=regional_publisher] [--dry-run]

Examples:
  npm run sources:add -- dailypost.ng
  npm run sources:add -- https://thenationonlineng.net --name="The Nation"

Finds the site's RSS feed (from its home page, else /feed/, /rss and similar), reads its robots.txt, test-parses
the feed, and only then adds it to src/config/extra-sources.json. Needs internet access. After it succeeds,
commit that one file and redeploy; the site is ingested from the next scheduled run.`;

function option(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function homepageFeedCandidates(site: URL): Promise<string[]> {
  const found: string[] = [];
  try {
    const response = await fetch(site, {
      headers: { "user-agent": feedUserAgent(process.env.NSM_INGESTION_CONTACT), accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const html = (await response.text()).slice(0, 1_000_000);
      found.push(...findFeedLinks(html, response.url || site.toString()));
    }
  } catch {
    // Fall through to the conventional paths.
  }
  for (const feedPath of FALLBACK_FEED_PATHS) {
    const url = new URL(feedPath, site).toString();
    if (!found.includes(url)) found.push(url);
  }
  return found;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith("--"));
  if (args.includes("--help") || !input) {
    console.log(USAGE);
    process.exitCode = input ? 0 : 2;
    return;
  }

  const site = normaliseSiteUrl(input);
  const existing: ExtraSourceEntry[] = JSON.parse(readFileSync(FILE, "utf8"));
  const taken = new Set([...INGESTION_SOURCES.map((source) => source.slug)]);
  const slug = option(args, "slug") ?? slugFromHost(site.hostname, taken);
  const name = option(args, "name") ?? nameFromHost(site.hostname);
  const tier = option(args, "tier") as ExtraSourceEntry["tier"] | undefined;

  const duplicate = INGESTION_SOURCES.find((source) => new URL(source.baseUrl).hostname.replace(/^www\./, "") === site.hostname.replace(/^www\./, ""));
  if (duplicate) {
    console.log(`Already registered as "${duplicate.slug}" (${duplicate.name}). Nothing to do.`);
    return;
  }

  console.log(`Looking for ${site.hostname}'s feed...`);
  let chosen: { feedUrl: string; items: number; newest: string | null } | null = null;
  for (const feedUrl of await homepageFeedCandidates(site)) {
    const probe = probeSourceFor({ slug: "probe-site", name, feedUrl });
    const robots = await checkRobots(probe, { userAgent: feedUserAgent(process.env.NSM_INGESTION_CONTACT) });
    if (!robots.allowed) {
      console.log(`  ✗ ${feedUrl}: ${robots.reason}`);
      continue;
    }
    try {
      const fetched = await fetchFeed(probe);
      const parsed = parseRssFeed(fetched.xml, 100);
      if (parsed.items.length === 0) {
        console.log(`  ✗ ${feedUrl}: feed is empty`);
        continue;
      }
      const times = parsed.items.map((item) => (item.pubDate ? Date.parse(item.pubDate) : Number.NaN)).filter((value) => !Number.isNaN(value));
      chosen = { feedUrl, items: parsed.items.length, newest: times.length ? new Date(Math.max(...times)).toISOString() : null };
      console.log(`  ✓ ${feedUrl}: ${parsed.items.length} items, newest ${chosen.newest ?? "unknown"}`);
      break;
    } catch (error) {
      console.log(`  ✗ ${feedUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!chosen) {
    console.error(`\nNo usable RSS feed found for ${site.hostname}. It may have no feed, block automated requests, or forbid them in robots.txt.`);
    process.exitCode = 1;
    return;
  }

  const entry: ExtraSourceEntry = {
    slug,
    name,
    feedUrl: chosen.feedUrl,
    ...(tier ? { tier } : {}),
    evidence: { level: "verified", note: `Fetched and parsed (${chosen.items} items) by sources:add on ${new Date().toISOString().slice(0, 10)}.` },
  };
  // Validates the whole file together: a clash or bad field throws here, not in production.
  buildExtraSources([...existing, entry], new Set(INGESTION_SOURCES.filter((source) => !existing.some((item) => item.slug === source.slug)).map((source) => source.slug)));

  if (args.includes("--dry-run")) {
    console.log(`\nDry run: would add\n${JSON.stringify(entry, null, 2)}`);
    return;
  }
  writeFileSync(FILE, `${JSON.stringify([...existing, entry], null, 2)}\n`);
  console.log(`\nAdded "${name}" (${slug}) to src/config/extra-sources.json.\nCommit that file and redeploy. Terms of use were not reviewed: obtain the publisher's permission before relying on it.`);
}

main().catch((error: unknown) => {
  console.error("sources:add failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
