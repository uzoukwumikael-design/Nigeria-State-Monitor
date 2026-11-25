"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useState } from "react";
import { ConnectivityWatcher } from "@/lib/offline/watcher";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectivityWatcher />
      <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={100}>
        {children}
      </TooltipPrimitive.Provider>
    </QueryClientProvider>
  );
}
