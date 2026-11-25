"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, RadioTower, TriangleAlert } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface HealthData {
  status: string;
  mode: string;
  database: string;
  ingestion: string;
  aiEnrichment: string;
  realtime: string;
  lastSuccessfulSync: string | null;
  datasetVersion: string;
  datasetGeneratedAt: string;
  referenceTime: string;
  coverage: { from: string | null; to: string | null; label: string };
  sources: { total: number; live: number; demo: number; healthy: number };
  counts: { events: number; states: number };
  limitations: string[];
  disclaimer: string | null;
}

interface HealthResponse {
  data: HealthData;
}

async function fetchHealth(): Promise<HealthData> {
  const response = await fetch("/api/system/health", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Health check failed (${response.status})`);
  const payload = (await response.json()) as HealthResponse;
  return payload.data;
}

export function HealthPill({ liteMode }: { liteMode: boolean }) {
  const { data, isError } = useQuery({
    queryKey: ["system-health"],
    queryFn: fetchHealth,
    refetchInterval: liteMode ? false : 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const status = isError ? "unavailable" : (data?.status ?? "demo");
  const isDemo = status === "demo";
  const isHealthy = status === "healthy";
  const label = isError
    ? "Status unavailable"
    : isDemo
      ? "Demo · static"
      : isHealthy
        ? "Data connected"
        : "Degraded";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded border px-2 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-info",
            isError
              ? "border-critical/35 bg-critical/10 text-critical"
              : isDemo || !isHealthy
                ? "border-warning/35 bg-warning/10 text-warning hover:bg-warning/15"
                : "border-positive/35 bg-positive/10 text-positive",
          )}
          aria-label={`Data status: ${label}. Open details.`}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isError
                ? "bg-critical"
                : isHealthy
                  ? "bg-positive"
                  : "bg-warning",
            )}
            aria-hidden
          />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">
            {isDemo ? "DEMO" : isError ? "ERR" : isHealthy ? "LIVE" : "DEG"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px]" align="end">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
            Data status
          </p>
          <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-warning">
            {status}
          </span>
        </div>
        <div className="space-y-2 text-[11px] leading-relaxed text-muted">
          {data ? (
            <>
              <p className="text-ink">
                {data.mode === "demo"
                  ? "Demo snapshot served from the active repository. No live dashboard feed, AI enrichment or realtime channel is connected."
                  : "Production snapshot. No scheduled ingestion, AI enrichment or realtime channel is connected."}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-faint">Database</dt>
                <dd className="flex items-center gap-1.5 text-muted">
                  <Database className="size-3" aria-hidden />
                  {data.database === "connected"
                    ? "connected"
                    : "not connected"}
                </dd>
                <dt className="text-faint">Ingestion</dt>
                <dd className="flex items-center gap-1.5 text-muted">
                  <RadioTower className="size-3" aria-hidden /> not connected to
                  dashboard
                </dd>
                <dt className="text-faint">Sources</dt>
                <dd>
                  {data.sources.total} sources · {data.sources.demo} demo ·{" "}
                  {data.sources.live} live
                </dd>
                <dt className="text-faint">Last sync</dt>
                <dd>
                  {data.lastSuccessfulSync
                    ? formatDateTime(data.lastSuccessfulSync)
                    : "Never — static snapshot"}
                </dd>
                <dt className="text-faint">Dataset</dt>
                <dd className="font-mono text-[10px]">{data.datasetVersion}</dd>
                <dt className="text-faint">Generated</dt>
                <dd>{formatDateTime(data.datasetGeneratedAt)}</dd>
              </dl>
              <p className="flex gap-1.5 rounded border border-warning/20 bg-warning/5 p-2 text-[10px] text-warning/90">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                {data.disclaimer ?? "DEMO DATA — NOT A REAL INCIDENT"}
              </p>
            </>
          ) : isError ? (
            <p>
              The status endpoint is unavailable. The dashboard may still show
              the initial snapshot, but no live health information can be
              confirmed.
            </p>
          ) : (
            <p>Checking data status…</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
