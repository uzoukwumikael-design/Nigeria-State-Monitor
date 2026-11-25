"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { useConnectivityStore } from "@/lib/offline/store";

/**
 * Makes saved data impossible to mistake for live data. Offline: say so and
 * give the dataset time. Online but served from the device's saved copies:
 * say how old the oldest copy is.
 */
export function ConnectivityBanner({ datasetAsOf }: { datasetAsOf: string }) {
  const online = useConnectivityStore((state) => state.online);
  const cachedAt = useConnectivityStore((state) => state.cachedAt);
  const cachedCount = useConnectivityStore((state) => state.cachedCount);
  const clearCached = useConnectivityStore((state) => state.clearCached);
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  if (online && cachedCount === 0) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      const response = await fetch("/api/system/health", { cache: "no-store" });
      if (response.ok) {
        clearCached();
        await queryClient.invalidateQueries();
      }
    } catch {
      // Still unreachable; the banner stays.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connectivity-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[10.5px] text-warning"
    >
      <CloudOff className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {online ? (
          <>
            <strong className="font-semibold">Saved data, not live.</strong>{" "}
            Some panels are showing copies saved on this device
            {cachedAt ? ` (oldest from ${formatDateTime(cachedAt)})` : ""}{" "}
            because the server could not be reached.
          </>
        ) : (
          <>
            <strong className="font-semibold">You are offline.</strong> What you
            see is the data saved on this device (dataset as of{" "}
            {formatDateTime(datasetAsOf)}). Nothing newer is shown, and it may
            be out of date.
          </>
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={retry}
        disabled={retrying}
        className="h-6 px-2 text-[10px]"
      >
        {retrying ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        Retry now
      </Button>
    </div>
  );
}
