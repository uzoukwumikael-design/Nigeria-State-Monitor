/* Nigeria State Monitor service worker.
 *
 * Goals: keep the app usable on slow or dropped connections, and never let
 * saved data pass as live data.
 *   - Static assets (hashed bundles, geography, map worker): cache-first.
 *   - Page navigations: network-first, falling back to the last visited copy.
 *   - GET /api/*: network-first; on failure serve the last good copy and say so
 *     (X-NSM-Served-From / X-NSM-Cached-At headers + a message to open tabs).
 *   - Reviewer, cron, session and health endpoints are never cached.
 */
// The page registers /sw.js?v=<build id>; keying the caches on it means every deploy starts clean
// and the previous deploy's saved bundles are deleted on activate.
const BUILD = (new URL(self.location.href).searchParams.get("v") || "dev").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "dev";
const VERSION = "v1-" + BUILD;
const PREFIX = "nsm-sw-";
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const PAGES_CACHE = `${PREFIX}pages-${VERSION}`;
const API_CACHE = `${PREFIX}api-${VERSION}`;
const ALL_CACHES = [STATIC_CACHE, PAGES_CACHE, API_CACHE];

const OFFLINE_URL = "/offline.html";
const STATIC_MAX_ENTRIES = 250;
const API_MAX_ENTRIES = 80;
const PAGES_MAX_ENTRIES = 12;
// "Slow" is when we start showing the saved copy (the real request keeps running and refreshes the cache);
// "hard" is when we finally give up on the request.
const NAVIGATION_SLOW_MS = 5000;
const NAVIGATION_HARD_MS = 45000;
const API_SLOW_MS = 6000;
const API_HARD_MS = 30000;

const NEVER_CACHE = ["/api/review", "/api/cron", "/api/system/health", "/review"];
const STATIC_PREFIXES = ["/_next/static/", "/data/", "/maplibre/"];
const STATIC_FILES = ["/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name.startsWith(PREFIX) && !ALL_CACHES.includes(name)).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isNeverCached(pathname) {
  return NEVER_CACHE.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/") || pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || STATIC_FILES.includes(pathname);
}

async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let index = 0; index < keys.length - maxEntries; index += 1) {
    await cache.delete(keys[index]);
  }
}

/** Keeps the newest entries; the offline fallback page is never evicted. */
async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = (await cache.keys()).filter((key) => new URL(typeof key === "string" ? key : key.url, self.location.origin).pathname !== OFFLINE_URL);
  for (let index = 0; index < keys.length - STATIC_MAX_ENTRIES; index += 1) {
    await cache.delete(keys[index]);
  }
}

async function withCachedAt(response) {
  const headers = new Headers(response.headers);
  headers.set("x-nsm-cached-at", new Date().toISOString());
  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function asCachedResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("x-nsm-served-from", "cache");
  return {
    cachedAt: headers.get("x-nsm-cached-at"),
    response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
  };
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    await cache.put(request, response.clone());
    await trimStatic();
  }
  return response;
}

const SLOW = {};

/**
 * Network-first with a patient fallback. If the network answers in time, that response wins and is saved.
 * If it is merely slow (common on mobile data), the saved copy is shown after `slowMs` while the real request
 * keeps going so the cache is refreshed for next time. A request is abandoned only after `hardMs`.
 */
async function networkFirst(event, request, options) {
  const cache = await caches.open(options.cacheName);
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), options.hardMs);

  const network = fetch(request, { signal: controller.signal }).then(async (response) => {
    clearTimeout(hardTimer);
    if (response.status === 200) {
      await cache.put(request, await withCachedAt(response));
      await trim(options.cacheName, options.maxEntries);
    }
    return response;
  });
  network.catch(() => clearTimeout(hardTimer));

  const serveSaved = async () => {
    const saved = await options.lookup(cache, request);
    if (!saved) return null;
    const served = asCachedResponse(saved);
    notifyClients({ type: "nsm-served-from-cache", kind: options.kind, url: new URL(request.url).pathname, cachedAt: served.cachedAt });
    return served.response;
  };

  let slowTimer;
  const slow = new Promise((resolve) => {
    slowTimer = setTimeout(() => resolve(SLOW), options.slowMs);
  });

  try {
    const winner = await Promise.race([network, slow]);
    clearTimeout(slowTimer);
    if (winner === SLOW) {
      const saved = await serveSaved();
      if (saved) {
        // Let the real request finish in the background so the saved copy is refreshed.
        event.waitUntil(network.catch(() => undefined));
        return saved;
      }
      return await network;
    }
    if (winner.status >= 500 && options.fallbackOn5xx) {
      const saved = await serveSaved();
      if (saved) return saved;
    }
    return winner;
  } catch (error) {
    clearTimeout(slowTimer);
    const saved = await serveSaved();
    if (saved) return saved;
    if (options.finalFallback) {
      const fallback = await options.finalFallback();
      if (fallback) return fallback;
    }
    throw error;
  }
}

const pageOptions = {
  cacheName: PAGES_CACHE,
  kind: "page",
  slowMs: NAVIGATION_SLOW_MS,
  hardMs: NAVIGATION_HARD_MS,
  maxEntries: PAGES_MAX_ENTRIES,
  fallbackOn5xx: false,
  lookup: async (cache, request) => {
    const url = new URL(request.url);
    return (
      (await cache.match(request, { ignoreVary: true })) ||
      (await cache.match(url.origin + "/", { ignoreSearch: true, ignoreVary: true }))
    );
  },
  finalFallback: async () => (await caches.open(STATIC_CACHE)).match(OFFLINE_URL),
};

const apiOptions = {
  cacheName: API_CACHE,
  kind: "api",
  slowMs: API_SLOW_MS,
  hardMs: API_HARD_MS,
  maxEntries: API_MAX_ENTRIES,
  fallbackOn5xx: true,
  lookup: (cache, request) => cache.match(request, { ignoreVary: true }),
  finalFallback: null,
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;
  // Next.js RSC payload requests are tied to the live server render.
  if (request.headers.get("rsc") || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(event, request, apiOptions));
    return;
  }
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, request, pageOptions));
  }
});

/* The very first visit happens before this worker controls the page, so its bundles and HTML
 * never pass through the fetch handler. After activation the page lists what it already loaded
 * and we save those same-origin, allow-listed URLs so a first-time visitor can go offline. */
const MAX_PRECACHE_URLS = 120;

function allowedPrecacheUrl(raw) {
  try {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) return null;
    if (isNeverCached(url.pathname)) return null;
    if (!isStaticAsset(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function precache(message) {
  const staticUrls = (Array.isArray(message.urls) ? message.urls : [])
    .slice(0, MAX_PRECACHE_URLS)
    .map(allowedPrecacheUrl)
    .filter(Boolean);
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(
    staticUrls.map(async (href) => {
      if (await staticCache.match(href, { ignoreVary: true })) return;
      try {
        const response = await fetch(href);
        if (response.ok && response.status === 200) await staticCache.put(href, response);
      } catch {
        /* best effort */
      }
    }),
  );

  await trimStatic();

  if (typeof message.page === "string") {
    try {
      const url = new URL(message.page, self.location.origin);
      if (url.origin === self.location.origin && url.pathname === "/" && !isNeverCached(url.pathname)) {
        const request = new Request(url.href, { headers: { accept: "text/html" } });
        const response = await fetch(request);
        if (response.ok && response.status === 200) {
          const pages = await caches.open(PAGES_CACHE);
          await pages.put(new Request(url.href), await withCachedAt(response));
        }
      }
    } catch {
      /* best effort */
    }
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "nsm-precache") event.waitUntil(precache(data));
});
