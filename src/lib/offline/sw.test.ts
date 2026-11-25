// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://nsm.test";

type Handler = (event: Record<string, unknown>) => void;

function keyOf(input: string | Request, ignoreSearch = false): string {
  const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
  return ignoreSearch ? url.origin + url.pathname : url.href;
}

class FakeCache {
  readonly store = new Map<string, Response>();
  async match(input: string | Request, options?: { ignoreSearch?: boolean }) {
    const wanted = keyOf(input, options?.ignoreSearch);
    for (const [key, value] of this.store) {
      if (keyOf(key, options?.ignoreSearch) === wanted) return value.clone();
    }
    return undefined;
  }
  async put(input: string | Request, response: Response) {
    this.store.set(keyOf(input), response);
  }
  async add(input: string | Request) {
    this.store.set(keyOf(input), new Response("offline-page", { status: 200 }));
  }
  async keys() {
    return [...this.store.keys()];
  }
  async delete(input: string | Request) {
    return this.store.delete(typeof input === "string" ? input : keyOf(input));
  }
}

function setup() {
  const handlers = new Map<string, Handler>();
  const cacheMap = new Map<string, FakeCache>();
  const posted: unknown[] = [];
  const network = { mode: "ok" as "ok" | "down" | number, calls: 0, body: "live", delayMs: 0 };
  const background: Promise<unknown>[] = [];

  const fakeFetch = async (_input?: unknown, init?: { signal?: AbortSignal }) => {
    network.calls += 1;
    if (network.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, network.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    if (network.mode === "down") throw new TypeError("Failed to fetch");
    if (typeof network.mode === "number") return new Response("err", { status: network.mode });
    return new Response(network.body, { status: 200, headers: { "content-type": "text/plain" } });
  };

  const self = {
    location: { origin: ORIGIN, href: ORIGIN + "/sw.js?v=test" },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ postMessage: (message: unknown) => posted.push(message) }],
    },
  };
  const caches = {
    open: async (name: string) => {
      if (!cacheMap.has(name)) cacheMap.set(name, new FakeCache());
      return cacheMap.get(name)!;
    },
    keys: async () => [...cacheMap.keys()],
    delete: async (name: string) => cacheMap.delete(name),
  };

  const context = vm.createContext({
    self,
    caches,
    fetch: fakeFetch,
    Request: class extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, ORIGIN).href : input, init);
      }
    },
    Response,
    Headers,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(SOURCE, context);

  async function fire(request: Request): Promise<Response | "ignored"> {
    let responded: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => (responded = value),
      waitUntil: (value: Promise<unknown>) => background.push(value),
    });
    return responded ? await responded : "ignored";
  }
  async function lifecycle(type: "install" | "activate") {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)!({ waitUntil: (value: Promise<unknown>) => (pending = value) });
    await pending;
  }
  // Browsers create navigation requests themselves; Node refuses mode "navigate", so fake that one property.
  async function message(data: unknown) {
    let pending: Promise<unknown> | undefined;
    handlers.get("message")!({ data, waitUntil: (value: Promise<unknown>) => (pending = value) });
    await pending;
  }
  const get = (path: string, init?: { mode?: string }) => {
    const request = new Request(ORIGIN + path, { method: "GET" });
    if (init?.mode === "navigate") Object.defineProperty(request, "mode", { value: "navigate" });
    return request;
  };

  return { fire, lifecycle, message, network, posted, cacheMap, get, background };
}

let sw: ReturnType<typeof setup>;
beforeEach(() => {
  sw = setup();
});

describe("service worker routing", () => {
  it("ignores non-GET, cross-origin and never-cached endpoints", async () => {
    expect(await sw.fire(new Request(ORIGIN + "/api/events", { method: "POST" }))).toBe("ignored");
    expect(await sw.fire(new Request("https://other.test/api/events"))).toBe("ignored");
    for (const path of ["/api/review/candidates", "/api/cron/ingest", "/api/system/health", "/review", "/api/events?_rsc=1"]) {
      expect(await sw.fire(sw.get(path))).toBe("ignored");
    }
    expect(sw.network.calls).toBe(0);
  });
});

describe("API responses", () => {
  it("passes live responses through and keeps a copy", async () => {
    const response = (await sw.fire(sw.get("/api/events"))) as Response;
    expect(await response.text()).toBe("live");
    expect(response.headers.get("x-nsm-served-from")).toBeNull();
    expect(sw.posted).toHaveLength(0);
  });

  it("serves the saved copy, labelled and announced, when the network is down", async () => {
    await sw.fire(sw.get("/api/events"));
    sw.network.mode = "down";
    const response = (await sw.fire(sw.get("/api/events"))) as Response;
    expect(await response.text()).toBe("live");
    expect(response.headers.get("x-nsm-served-from")).toBe("cache");
    const cachedAt = response.headers.get("x-nsm-cached-at");
    expect(cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sw.posted).toEqual([{ type: "nsm-served-from-cache", kind: "api", url: "/api/events", cachedAt }]);
  });

  it("falls back to the saved copy on a 5xx but passes 4xx through unchanged", async () => {
    await sw.fire(sw.get("/api/states"));
    sw.network.mode = 503;
    const stale = (await sw.fire(sw.get("/api/states"))) as Response;
    expect(stale.headers.get("x-nsm-served-from")).toBe("cache");
    sw.network.mode = 429;
    const limited = (await sw.fire(sw.get("/api/states"))) as Response;
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-nsm-served-from")).toBeNull();
  });

  it("does not invent data: offline with no saved copy is a network error", async () => {
    sw.network.mode = "down";
    await expect(sw.fire(sw.get("/api/search?q=lagos"))).rejects.toThrow();
  });

  it("never saves error responses", async () => {
    sw.network.mode = 500;
    await sw.fire(sw.get("/api/sources"));
    sw.network.mode = "down";
    await expect(sw.fire(sw.get("/api/sources"))).rejects.toThrow();
  });
});

describe("page navigations", () => {
  it("serves the last visited page offline and announces it", async () => {
    await sw.lifecycle("install");
    sw.network.body = "<html>dashboard</html>";
    await sw.fire(sw.get("/", { mode: "navigate" }));
    sw.network.mode = "down";
    const response = (await sw.fire(sw.get("/", { mode: "navigate" }))) as Response;
    expect(await response.text()).toBe("<html>dashboard</html>");
    expect(response.headers.get("x-nsm-served-from")).toBe("cache");
    expect(sw.posted[0]).toMatchObject({ type: "nsm-served-from-cache", kind: "page" });
  });

  it("shows the offline page when nothing was ever saved", async () => {
    await sw.lifecycle("install");
    sw.network.mode = "down";
    const response = (await sw.fire(sw.get("/", { mode: "navigate" }))) as Response;
    expect(await response.text()).toBe("offline-page");
  });
});

describe("static assets and lifecycle", () => {
  it("serves hashed assets cache-first without re-hitting the network", async () => {
    await sw.fire(sw.get("/_next/static/chunks/app.js"));
    expect(sw.network.calls).toBe(1);
    await sw.fire(sw.get("/_next/static/chunks/app.js"));
    expect(sw.network.calls).toBe(1);
  });

  it("removes only older NSM caches on activate", async () => {
    await sw.lifecycle("install");
    sw.cacheMap.set("nsm-sw-api-v0", new FakeCache());
    sw.cacheMap.set("someone-elses-cache", new FakeCache());
    await sw.lifecycle("activate");
    expect(sw.cacheMap.has("nsm-sw-api-v0")).toBe(false);
    expect(sw.cacheMap.has("someone-elses-cache")).toBe(true);
    expect(sw.cacheMap.has("nsm-sw-static-v1-test")).toBe(true);
  });
});

describe("first-visit precache", () => {
  it("saves the assets and page a first-time visitor already loaded, so they can go offline", async () => {
    await sw.lifecycle("install");
    sw.network.body = "<html>first-visit dashboard</html>";
    await sw.message({
      type: "nsm-precache",
      urls: [ORIGIN + "/_next/static/chunks/main.js", "/data/ng-states.json"],
      page: "/",
    });
    sw.network.mode = "down";

    const asset = (await sw.fire(sw.get("/_next/static/chunks/main.js"))) as Response;
    expect(asset.ok).toBe(true);
    const page = (await sw.fire(sw.get("/", { mode: "navigate" }))) as Response;
    expect(await page.text()).toBe("<html>first-visit dashboard</html>");
    expect(page.headers.get("x-nsm-served-from")).toBe("cache");
  });

  it("only accepts same-origin, allow-listed static assets and ignores malformed messages", async () => {
    await sw.lifecycle("install");
    const before = sw.network.calls;
    await sw.message({
      type: "nsm-precache",
      urls: [
        "https://evil.test/_next/static/x.js",
        ORIGIN + "/api/events",
        ORIGIN + "/review",
        ORIGIN + "/api/review/candidates",
        "not a url at all %%%",
        42,
      ],
      page: "/review",
    });
    await sw.message("nope");
    await sw.message(null);
    await sw.message({ type: "something-else", urls: [ORIGIN + "/_next/static/a.js"] });
    expect(sw.network.calls).toBe(before);
  });
});

describe("per-build caches", () => {
  it("names caches after the build id from the registration URL", async () => {
    await sw.lifecycle("install");
    expect([...sw.cacheMap.keys()]).toContain("nsm-sw-static-v1-test");
  });

  it("deletes every cache from a previous build on activate", async () => {
    await sw.lifecycle("install");
    for (const name of ["nsm-sw-static-v1-oldbuild", "nsm-sw-pages-v1-oldbuild", "nsm-sw-api-v1-oldbuild"]) {
      sw.cacheMap.set(name, new FakeCache());
    }
    await sw.lifecycle("activate");
    expect([...sw.cacheMap.keys()].filter((name) => name.includes("oldbuild"))).toEqual([]);
    expect(sw.cacheMap.has("nsm-sw-static-v1-test")).toBe(true);
  });

  it("caps saved static assets but never evicts the offline page", async () => {
    await sw.lifecycle("install");
    for (let index = 0; index < 260; index += 1) {
      await sw.fire(sw.get(`/_next/static/chunks/c${index}.js`));
    }
    const keys = await sw.cacheMap.get("nsm-sw-static-v1-test")!.keys();
    expect(keys.length).toBeLessThanOrEqual(251);
    expect(keys.some((key) => key.endsWith("/offline.html"))).toBe(true);
    expect(keys.some((key) => key.endsWith("/c0.js"))).toBe(false);
    expect(keys.some((key) => key.endsWith("/c259.js"))).toBe(true);
  });
});

describe("slow networks", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the saved copy when the network is slow but lets the real request finish and refresh the cache", async () => {
    vi.useFakeTimers();
    const slow = setup();
    await slow.lifecycle("install");
    slow.network.body = "<html>old</html>";
    await slow.fire(slow.get("/", { mode: "navigate" })); // saved

    slow.network.body = "<html>new</html>";
    slow.network.delayMs = 12_000;
    const pending = slow.fire(slow.get("/", { mode: "navigate" }));
    await vi.advanceTimersByTimeAsync(5_100);
    const shown = (await pending) as Response;
    expect(await shown.text()).toBe("<html>old</html>");
    expect(shown.headers.get("x-nsm-served-from")).toBe("cache");
    expect(slow.posted).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(7_000);
    await Promise.all(slow.background);
    slow.network.mode = "down";
    slow.network.delayMs = 0;
    const next = (await slow.fire(slow.get("/", { mode: "navigate" }))) as Response;
    expect(await next.text()).toBe("<html>new</html>");
  });

  it("keeps waiting for a slow network when nothing is saved, instead of giving up", async () => {
    vi.useFakeTimers();
    const slow = setup();
    slow.network.delayMs = 20_000;
    const pending = slow.fire(slow.get("/api/events"));
    await vi.advanceTimersByTimeAsync(20_100);
    const response = (await pending) as Response;
    expect(await response.text()).toBe("live");
    expect(response.headers.get("x-nsm-served-from")).toBeNull();
  });

  it("abandons a request only after the hard limit", async () => {
    vi.useFakeTimers();
    const slow = setup();
    slow.network.delayMs = 10 * 60_000;
    const pending = slow.fire(slow.get("/api/events"));
    const settled = pending.then(
      () => "resolved",
      () => "rejected",
    );
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await settled).toBe("rejected");
  });
});
