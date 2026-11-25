const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "_ga",
  "_gl",
]);

export interface UrlResult {
  url: string | null;
  reason?: string;
}

function isTrackingParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower);
}

/**
 * Canonicalises a publisher article URL without changing its meaning.
 * Only HTTPS, allow-listed hosts and default ports are accepted. Tracking
 * parameters and fragments are removed so the same article deduplicates.
 */
export function canonicalizeArticleUrl(
  raw: string,
  baseUrl: string,
  allowedHosts: readonly string[],
  anyPublicHost = false,
): UrlResult {
  let parsed: URL;
  try {
    parsed = new URL(raw, baseUrl);
  } catch {
    return { url: null, reason: "invalid_url" };
  }

  if (parsed.protocol !== "https:") {
    return { url: null, reason: "non_https_url" };
  }
  if (parsed.username || parsed.password) {
    return { url: null, reason: "url_contains_credentials" };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (anyPublicHost ? !isPublicHostname(hostname) : !allowedHosts.includes(hostname)) {
    return { url: null, reason: "host_not_allowed" };
  }
  if (parsed.port && parsed.port !== "443") {
    return { url: null, reason: "non_default_port" };
  }

  parsed.hostname = hostname;
  parsed.port = "";
  parsed.hash = "";

  for (const name of [...parsed.searchParams.keys()]) {
    if (isTrackingParameter(name)) parsed.searchParams.delete(name);
  }
  parsed.searchParams.sort();

  return { url: parsed.toString() };
}

/** A plausible public DNS name: not an IP literal, not localhost, not an internal or single-label name. */
export function isPublicHostname(hostname: string): boolean {
  if (!hostname.includes(".") || hostname.length > 253) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":") || hostname.startsWith("[")) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(hostname)) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname);
}

export function isPromotedUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path === "/promoted" || path.startsWith("/promoted/");
  } catch {
    return false;
  }
}

const OUT_OF_SCOPE_SECTIONS = [
  "sports",
  "sport",
  "entertainment",
  "celebrity",
  "lifestyle",
  "music",
  "movies",
  "foreign",
  "pt-jobs",
] as const;

/**
 * Premium Times groups football and world-news items in the same feed. NSM
 * monitors Nigerian governance, security, economy, infrastructure, environment
 * and health, so those sections are excluded before any proposal is stored.
 * The list is applied to the URL path, not to topic tags, because tags are
 * reused loosely.
 */
export function outOfScopeSection(url: string): string | null {
  try {
    const segments = new URL(url).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);
    const first = segments[0];
    return first && (OUT_OF_SCOPE_SECTIONS as readonly string[]).includes(first) ? first : null;
  } catch {
    return null;
  }
}

const PROMOTED_TAGS = new Set(["promoted", "promoted stories", "sponsored", "advertisement"]);

export function isPromotedItem(categories: readonly string[]): boolean {
  return categories.some((category) => PROMOTED_TAGS.has(category.trim().toLowerCase()));
}

export function assertHttpsFeedUrl(raw: string, allowedHosts: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("The feed URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("The feed URL must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("The feed URL must not contain credentials.");
  }
  if (!allowedHosts.includes(parsed.hostname.toLowerCase().replace(/\.$/, ""))) {
    throw new Error(`The feed host ${parsed.hostname} is not in the source allow-list.`);
  }
  return parsed;
}
