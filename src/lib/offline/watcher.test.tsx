import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConnectivityStore } from "@/lib/offline/store";
import { ConnectivityWatcher } from "@/lib/offline/watcher";

function mountWatcher() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ConnectivityWatcher />
    </QueryClientProvider>,
  );
  return { invalidate };
}

afterEach(() => {
  cleanup();
  useConnectivityStore.setState({ online: true, cachedAt: null, cachedCount: 0 });
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("ConnectivityWatcher", () => {
  it("asks the worker to save the loaded assets only when it takes control, not on every page load", async () => {
    const postMessage = vi.fn();
    const worker = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(worker, {
        register: vi.fn(async () => undefined),
        ready: Promise.resolve({ active: { postMessage } }),
      }),
    });
    mountWatcher();
    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();

    await act(async () => {
      worker.dispatchEvent(new Event("controllerchange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({ type: "nsm-precache", page: "/" });
  });

  it("tracks going offline and, on reconnect, clears saved-data flags and refetches", () => {
    const { invalidate } = mountWatcher();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(useConnectivityStore.getState().online).toBe(false);

    useConnectivityStore.getState().noteCached("2026-11-01T08:00:00.000Z");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(useConnectivityStore.getState().online).toBe(true);
    expect(useConnectivityStore.getState().cachedCount).toBe(0);
    expect(invalidate).toHaveBeenCalled();
  });

  it("records service-worker messages about saved responses and ignores unrelated ones", () => {
    const worker = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(worker, { register: vi.fn(async () => undefined) }),
    });
    mountWatcher();

    act(() => {
      worker.dispatchEvent(new MessageEvent("message", { data: { type: "nsm-served-from-cache", cachedAt: "2026-11-01T08:00:00.000Z" } }));
      worker.dispatchEvent(new MessageEvent("message", { data: { type: "something-else" } }));
      worker.dispatchEvent(new MessageEvent("message", { data: "text" }));
    });
    expect(useConnectivityStore.getState().cachedCount).toBe(1);
    expect(useConnectivityStore.getState().cachedAt).toBe("2026-11-01T08:00:00.000Z");
  });
});
