import type { FetchLike } from "@/lib/ingestion/fetch";
import type { IngestionSource } from "@/lib/ingestion/types";

/** Product token that robots.txt groups may address; "*" is used when no group names it. */
export const ROBOTS_PRODUCT_TOKEN = "nigeriastatemonitor";

const MAX_ROBOTS_BYTES = 256 * 1024;
const ROBOTS_TIMEOUT_MS = 10_000;
const MAX_ROBOTS_REDIRECTS = 2;

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: Rule[];
  /** Crawl-delay for our group in seconds, if declared. */
  crawlDelaySeconds: number | null;
  /** Which group applied: our token, "*", or none. */
  matchedGroup: "product" | "wildcard" | "none";
}

export interface RobotsVerdict {
  allowed: boolean;
  crawlDelayMs: number | null;
  reason: string;
  /** True when robots.txt could not be read and we defaulted to the conservative answer. */
  unavailable: boolean;
}

/** Parses robots.txt (RFC 9309 subset: user-agent, allow, disallow, crawl-delay). Unknown lines are ignored. */
export function parseRobots(text: string): RobotsPolicy {
  type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything"; an empty Allow is ignored.
      if (value === "") continue;
      current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600) current.crawlDelay = seconds;
    }
  }

  const product = groups.filter((group) => group.agents.some((agent) => agent !== "*" && ROBOTS_PRODUCT_TOKEN.includes(agent)));
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const chosen = product.length > 0 ? product : wildcard;
  const matchedGroup = product.length > 0 ? "product" : wildcard.length > 0 ? "wildcard" : "none";
  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelaySeconds: chosen.map((group) => group.crawlDelay).find((value) => value !== null) ?? null,
    matchedGroup,
  };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
export function isPathAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const rule of policy.rules) {
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

export interface RobotsCheckOptions {
  fetchImpl?: FetchLike;
  userAgent?: string;
}

/**
 * Reads the publisher's robots.txt and decides whether our feed URL may be fetched.
 * Any 4xx other than 429 means no restrictions (RFC 9309). Anything else we cannot read (429, 5xx, network error,
 * oversize, redirect off the allowed hosts) is treated as "do not fetch".
 */
export async function checkRobots(
  source: Pick<IngestionSource, "baseUrl" | "feedUrl" | "allowedHosts">,
  options: RobotsCheckOptions = {},
): Promise<RobotsVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const feed = new URL(source.feedUrl);
  let current = new URL("/robots.txt", source.baseUrl);

  const unavailable = (reason: string): RobotsVerdict => ({
    allowed: false,
    crawlDelayMs: null,
    reason,
    unavailable: true,
  });

  try {
    for (let hop = 0; hop <= MAX_ROBOTS_REDIRECTS; hop += 1) {
      if (current.protocol !== "https:" || !source.allowedHosts.includes(current.hostname)) {
        return unavailable(`robots.txt redirected outside the allowed hosts (${current.hostname}).`);
      }
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: {
          accept: "text/plain",
          ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
        },
        signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return unavailable("robots.txt redirect had no Location header.");
        current = new URL(location, current);
        continue;
      }
      // RFC 9309: a 4xx answer (not found, forbidden, gone...) means the site has no robots.txt rules we can read, so
      // there are none to obey. Only 429 (asked to slow down) and server errors mean "do not fetch yet".
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        await response.body?.cancel();
        return { allowed: true, crawlDelayMs: null, reason: "No robots.txt (HTTP " + response.status + "); no restrictions declared.", unavailable: false };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        return unavailable(`robots.txt responded HTTP ${response.status}; not fetching until it can be read.`);
      }
      const text = await response.text();
      if (text.length > MAX_ROBOTS_BYTES) return unavailable("robots.txt is unusually large; not fetching.");
      const policy = parseRobots(text);
      const target = feed.pathname + feed.search;
      const allowed = isPathAllowed(policy, target);
      const crawlDelayMs = policy.crawlDelaySeconds === null ? null : policy.crawlDelaySeconds * 1000;
      return {
        allowed,
        crawlDelayMs,
        unavailable: false,
        reason: allowed
          ? `robots.txt allows ${target}${crawlDelayMs ? ` (Crawl-delay ${policy.crawlDelaySeconds}s)` : ""}.`
          : `robots.txt disallows ${target} for ${policy.matchedGroup === "product" ? "our user agent" : "all user agents"}.`,
      };
    }
    return unavailable("robots.txt exceeded the redirect limit.");
  } catch (error) {
    return unavailable(`robots.txt could not be fetched: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
}
