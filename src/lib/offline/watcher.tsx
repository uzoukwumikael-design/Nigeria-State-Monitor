"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectivityStore } from "@/lib/offline/store";

interface CacheMessage {
  type: "nsm-served-from-cache";
  cachedAt?: string | null;
}

function isCacheMessage(data: unknown): data is CacheMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "nsm-served-from-cache";
}

/**
 * A first visit loads its bundles before the worker controls the page, so they never pass through
 * the worker. Tell it which same-origin assets we already have so they can be saved for offline use.
 */
function shareLoadedAssets(worker: ServiceWorker | null): void {
  if (!worker || typeof performance === "undefined") return;
  const urls = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        const url = new URL(name);
        return url.origin === window.location.origin && /^\/(_next\/static|data|maplibre)\//.test(url.pathname);
      } catch {
        return false;
      }
    });
  worker.postMessage({ type: "nsm-precache", urls, page: window.location.pathname === "/" ? "/" : null });
}

/**
 * Mounts once. Registers the service worker (production builds only), tracks
 * browser connectivity, records when saved responses were served, and
 * refetches everything when the connection returns.
 */
export function ConnectivityWatcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setOnline, noteCached, clearCached } = useConnectivityStore.getState();
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      clearCached();
      void queryClient.invalidateQueries();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    let removeWorkerListeners: (() => void) | undefined;
    if ("serviceWorker" in navigator) {
      const onMessage = (event: MessageEvent) => {
        if (isCacheMessage(event.data)) noteCached(event.data.cachedAt ?? null);
      };
      // Fires when a worker takes control: on a first visit, and after a new deployment's worker activates.
      // Returning visits already pass through the worker, so nothing is re-saved on every page load.
      const onControllerChange = () => {
        void navigator.serviceWorker.ready.then((registration) => shareLoadedAssets(registration.active));
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      removeWorkerListeners = () => {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      };
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register(`/sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? "dev")}`, { scope: "/" })
          .catch((error: unknown) => {
            console.error("service_worker_registration_failed", error);
          });
      }
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      removeWorkerListeners?.();
    };
  }, [queryClient]);

  return null;
}
