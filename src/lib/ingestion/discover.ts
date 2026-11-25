/** Paths tried when a page does not advertise its feed. WordPress sites, most Nigerian outlets, use /feed/. */
export const FALLBACK_FEED_PATHS = ["/feed/", "/feed", "/rss", "/rss.xml", "/index.xml"] as const;

const RSS_TYPES = ["application/rss+xml", "application/rdf+xml"];

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[1] ?? match[2] ?? "").trim() : null;
}

/**
 * Reads <link rel="alternate" type="application/rss+xml" href="..."> tags from a page and returns absolute
 * HTTPS URLs on the same site (the bare or www host). Atom feeds are ignored: the pipeline reads RSS only.
 */
export function findFeedLinks(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const bare = page.hostname.replace(/^www\./, "");
  const found: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, "rel")?.toLowerCase() ?? "";
    const type = attribute(tag, "type")?.toLowerCase() ?? "";
    const href = attribute(tag, "href");
    if (!href || !rel.split(/\s+/).includes("alternate") || !RSS_TYPES.includes(type)) continue;
    try {
      const url = new URL(href, page);
      const host = url.hostname.replace(/^www\./, "");
      if (url.protocol !== "https:" || host !== bare) continue;
      url.hash = "";
      if (!found.includes(url.toString())) found.push(url.toString());
    } catch {
      continue;
    }
  }
  return found;
}

/** "www.dailypost.ng" -> "dailypost"; avoids a slug the registry already uses. */
export function slugFromHost(host: string, taken: ReadonlySet<string> = new Set()): string {
  const label = host.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  const base = label.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").padEnd(3, "x").slice(0, 36);
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free slug for ${host}.`);
}

/** "www.dailypost.ng" -> "Dailypost". A readable placeholder; pass --name to override. */
export function nameFromHost(host: string): string {
  const label = host.toLowerCase().replace(/^www\./, "").split(".")[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Normalises user input like "dailypost.ng" or "https://www.dailypost.ng/news" to an https origin. */
export function normaliseSiteUrl(input: string): URL {
  const trimmed = input.trim();
  const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (url.protocol !== "https:") throw new Error("Only https:// sites can be added.");
  if (url.username || url.password) throw new Error("Site addresses must not contain credentials.");
  if (!url.hostname.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname === "localhost") {
    throw new Error("Enter a public website address such as dailypost.ng.");
  }
  return new URL(url.origin);
}
