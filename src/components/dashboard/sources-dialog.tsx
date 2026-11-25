"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Rss, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/primitives";
import { formatDateTime, relativeTime } from "@/lib/format";
import type { SourceStatusRow, SourceStatusSummary } from "@/lib/ingestion/source-status";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface SourcesResponse {
  data: { sources: SourceStatusRow[]; summary: SourceStatusSummary; healthAvailable: boolean };
}

async function fetchSources(signal: AbortSignal): Promise<SourcesResponse["data"]> {
  const response = await fetch("/api/sources/status", { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Sources unavailable (${response.status})`);
  return ((await response.json()) as SourcesResponse).data;
}

const STATE_BADGE: Record<SourceStatusRow["state"], { label: string; variant: "positive" | "warning" | "critical" | "muted" | "default" }> = {
  healthy: { label: "Healthy", variant: "positive" },
  failing: { label: "Failing", variant: "warning" },
  paused: { label: "Paused", variant: "critical" },
  never_run: { label: "Not run yet", variant: "muted" },
  unknown: { label: "Unknown", variant: "default" },
  disabled: { label: "Disabled", variant: "muted" },
};

const EVIDENCE_BADGE: Record<SourceStatusRow["evidenceLevel"], { label: string; variant: "positive" | "info" | "muted" }> = {
  verified: { label: "Verified", variant: "positive" },
  third_party: { label: "Third-party", variant: "info" },
  directory: { label: "Directory only", variant: "muted" },
};

const TIER_LABEL: Record<SourceStatusRow["tier"], string> = {
  official: "Official",
  major_publisher: "National",
  regional_publisher: "Regional",
  aggregator: "Aggregator",
  unknown: "Other",
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded border border-line bg-panel-2/40 px-2.5 py-1.5">
      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className={cn("font-mono text-[16px] tabular text-ink", tone)}>{value}</p>
    </div>
  );
}

export function SourcesDialog({ referenceTime }: { referenceTime: string }) {
  const open = useDashboardStore((state) => state.sourcesOpen);
  const setOpen = useDashboardStore((state) => state.setSourcesOpen);
  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["sources-status"],
    queryFn: ({ signal }) => fetchSources(signal),
    enabled: open,
    staleTime: 30_000,
    retry: 1,
  });
  const nowIso = new Date().toISOString();
  void referenceTime;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl overflow-hidden p-0" aria-describedby="sources-description">
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Rss className="size-4 text-info" aria-hidden />
            News sources
          </DialogTitle>
          <DialogDescription id="sources-description" className="mt-1 text-[10.5px]">
            Every outlet the platform reads, how well its feed is evidenced, and how its recent runs went. A feed that
            keeps failing is paused automatically and retried later. Evidence labels say what is known, not what is hoped.
          </DialogDescription>
        </div>
        <div className="nsm-scroll max-h-[68dvh] space-y-3 overflow-y-auto p-3">
          {isPending ? (
            <div aria-busy="true" aria-label="Loading sources" className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading sources…
              </div>
              <Skeleton className="h-40 w-full" />
            </div>
          ) : isError || !data ? (
            <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <TriangleAlert className="size-3.5" aria-hidden /> Sources could not be loaded
              </p>
              <p className="mt-1 text-muted">{error instanceof Error ? error.message : "Unknown error."}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className={cn(isFetching && "animate-spin")} aria-hidden /> Retry
              </Button>
            </div>
          ) : (
            <>
              {!data.healthAvailable ? (
                <p role="status" className="rounded border border-line bg-panel-2 px-2.5 py-1.5 text-[10.5px] text-muted">
                  No database is connected, so run health and article counts are unknown. The evidence labels below still apply.
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-7" aria-label="Source summary">
                <Stat label="Sources" value={data.summary.total} />
                <Stat label="Healthy" value={data.summary.healthy} tone="text-positive" />
                <Stat label="Failing" value={data.summary.failing} tone={data.summary.failing ? "text-warning" : undefined} />
                <Stat label="Paused" value={data.summary.paused} tone={data.summary.paused ? "text-critical" : undefined} />
                <Stat label="Not run yet" value={data.summary.neverRun} />
                <Stat label="Unknown" value={data.summary.unknown} />
                <Stat label="Disabled" value={data.summary.disabled} />
              </div>
              <ul className="divide-y divide-line/60 rounded-md border border-line" aria-label="Registered news sources">
                {data.sources.map((row) => {
                  const state = STATE_BADGE[row.state];
                  const evidence = EVIDENCE_BADGE[row.evidenceLevel];
                  return (
                    <li key={row.slug} data-testid={`source-${row.slug}`} className="grid gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[1.4fr_1fr_1fr]">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-ink">
                          {row.name}
                          <Badge variant="outline" className="text-[8px]">{TIER_LABEL[row.tier]}</Badge>
                        </p>
                        <p className="font-mono text-[9px] text-faint">{row.host}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={state.variant} className="text-[8px]">{state.label}</Badge>
                          <Badge variant={evidence.variant} className="text-[8px]" title={row.evidenceNote}>{evidence.label}</Badge>
                        </p>
                        <p className="text-[9.5px] text-muted">{row.evidenceNote}</p>
                      </div>
                      <div className="font-mono text-[9.5px] text-muted">
                        {row.state === "paused" && row.retryAt ? (
                          <p className="text-critical">Retry after {formatDateTime(row.retryAt)}</p>
                        ) : null}
                        <p>
                          {row.lastSuccessfulSync ? `Last sync ${relativeTime(row.lastSuccessfulSync, nowIso)}` : "No successful sync yet"}
                        </p>
                        {row.articlesLast24h !== null ? (
                          <p>
                            {row.articlesLast24h} in 24 h · {row.articlesTotal} total
                          </p>
                        ) : null}
                        {row.lastError && row.state !== "healthy" ? (
                          <p className="text-warning" title={row.lastError}>
                            {row.lastError.slice(0, 90)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="font-mono text-[8px] uppercase tracking-[0.05em] text-faint">
                Verified = observed working by the project · Third-party = a feed reader shows recent posts · Directory only = listed
                in a public directory, not yet confirmed. Terms of use were reviewed for Premium Times only.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
