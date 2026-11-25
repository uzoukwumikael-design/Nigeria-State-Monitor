"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ExternalLink,
  Landmark,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/primitives";
import { categoryConfig, zoneConfig } from "@/lib/config";
import {
  DATA_STATUS_LABEL,
  formatIndicatorChange,
  formatIndicatorValue,
} from "@/lib/economy/format";
import type {
  EconomyObservation,
  EconomySnapshot,
  IndicatorLatest,
} from "@/lib/economy/types";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  relativeTime,
} from "@/lib/format";
import { useDashboardStore } from "@/lib/store";
import { ZONE_IDS, type IntelligenceEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface IndicatorsResponse {
  data: EconomySnapshot;
}

interface TrendData {
  code: string;
  name: string;
  unit: string;
  observations: EconomyObservation[];
  sourceLastUpdated: string | null;
  stale: boolean;
  error: string | null;
}

async function fetchIndicators(signal: AbortSignal): Promise<EconomySnapshot> {
  const response = await fetch("/api/economy/indicators", {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      body?.error?.message ??
        `Economic indicators unavailable (${response.status})`,
    );
  }
  return ((await response.json()) as IndicatorsResponse).data;
}

async function fetchTrend(
  code: string,
  signal: AbortSignal,
): Promise<TrendData> {
  const response = await fetch(
    `/api/economy/trends?code=${encodeURIComponent(code)}&years=30`,
    {
      signal,
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) throw new Error(`Trend unavailable (${response.status})`);
  return ((await response.json()) as { data: TrendData }).data;
}

function IndicatorCard({
  item,
  selected,
  onSelect,
}: {
  item: IndicatorLatest;
  selected: boolean;
  onSelect: () => void;
}) {
  const change = formatIndicatorChange(item);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-testid={`indicator-${item.code}`}
        className={cn(
          "flex h-full w-full flex-col gap-1 rounded-md border bg-panel-2/40 p-2.5 text-left transition-colors hover:border-line-2 focus-visible:outline-2 focus-visible:outline-info",
          selected ? "border-info/60 bg-info/[0.06]" : "border-line",
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-ink">
            {item.shortName}
          </span>
          <Badge
            variant={item.dataStatus === "official" ? "positive" : "warning"}
            className="ml-auto text-[8px]"
          >
            {DATA_STATUS_LABEL[item.dataStatus]}
          </Badge>
        </span>
        {item.latest ? (
          <>
            <span className="font-mono text-[18px] tabular text-ink">
              {formatIndicatorValue(item, item.latest.value)}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted">
              Reference year {item.latest.year}
            </span>
            {change ? (
              <span className="font-mono text-[9.5px] text-muted">
                {change}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-[10.5px] text-warning">
            {item.error
              ? "Could not be retrieved. No figure shown."
              : "No published values."}
          </span>
        )}
        <span className="mt-auto pt-1 font-mono text-[8px] uppercase tracking-[0.05em] text-faint">
          WDI {item.code}
          {item.sourceLastUpdated
            ? ` · source updated ${item.sourceLastUpdated}`
            : ""}
        </span>
      </button>
    </li>
  );
}

function TrendPanel({ item }: { item: IndicatorLatest }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["economy-trend", item.code],
    queryFn: ({ signal }) => fetchTrend(item.code, signal),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  return (
    <section
      aria-label={`${item.shortName} history`}
      className="rounded-md border border-line bg-panel-2/30 p-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[12px] font-medium text-ink">{item.name}</h3>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-info hover:underline"
        >
          Source series <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
      <p className="mt-1 text-[10.5px] text-muted">{item.description}</p>
      <div className="mt-2 h-44">
        {isPending ? (
          <Skeleton className="h-full w-full" />
        ) : isError || !data || !Array.isArray(data.observations) ? (
          <p className="grid h-full place-items-center text-[11px] text-warning">
            History could not be loaded.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.observations.map((point) => ({
                year: String(point.year),
                value: point.value,
              }))}
              margin={{ top: 6, right: 8, bottom: 0, left: -12 }}
            >
              <CartesianGrid
                stroke="#1b2638"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                tick={{ fill: "#64748b", fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: "#202b3d" }}
                minTickGap={16}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0f1b",
                  border: "1px solid #2b3a51",
                  fontSize: 11,
                }}
                formatter={(value) => [
                  formatIndicatorValue(item, Number(value)),
                  item.shortName,
                ]}
                labelFormatter={(label) => `Reference year ${label}`}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#35bdf2"
                strokeWidth={1.5}
                dot={{ r: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.05em] text-faint">
        Annual · unit: {item.unit} · years without a published value are
        omitted, not filled
      </p>
    </section>
  );
}

export function EconomyDialog({
  events,
  referenceTime,
}: {
  events: readonly IntelligenceEvent[];
  referenceTime: string;
}) {
  const open = useDashboardStore((state) => state.economyOpen);
  const setOpen = useDashboardStore((state) => state.setEconomyOpen);
  const selectEvent = useDashboardStore((state) => state.selectEvent);
  const setFilter = useDashboardStore((state) => state.setFilter);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["economy-indicators"],
    queryFn: ({ signal }) => fetchIndicators(signal),
    enabled: open,
    staleTime: 60 * 60 * 1000,
    // The server already caches and falls back to saved copies; a slow upstream should surface quickly with a manual Retry.
    retry: false,
  });

  const selected = useMemo(() => {
    if (!data) return null;
    return (
      data.indicators.find(
        (item) => item.code === selectedCode && item.latest,
      ) ??
      data.indicators.find((item) => item.latest) ??
      null
    );
  }, [data, selectedCode]);

  const economyEvents = useMemo(
    () =>
      events
        .filter((event) => event.category === "economy")
        .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt)),
    [events],
  );
  const byZone = useMemo(
    () =>
      ZONE_IDS.map((zone) => ({
        zone,
        count: economyEvents.filter((event) => event.zone === zone).length,
      })),
    [economyEvents],
  );
  const failed =
    data?.indicators.filter((item) => item.error && !item.latest).length ?? 0;
  const allDemo =
    economyEvents.length > 0 && economyEvents.every((event) => event.isDemo);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-4xl overflow-hidden p-0"
        aria-describedby="economy-description"
      >
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Landmark className="size-4 text-info" aria-hidden />
            Economic intelligence
          </DialogTitle>
          <DialogDescription
            id="economy-description"
            className="mt-1 text-[10.5px]"
          >
            National annual indicators from the World Bank World Development
            Indicators (CC BY 4.0). Each figure shows its own reference year and
            status; periods are never mixed. These series are separate from
            news-derived event counts. No state or zone level economic series
            are integrated.
          </DialogDescription>
        </div>

        <div className="nsm-scroll max-h-[70dvh] space-y-3 overflow-y-auto p-3">
          {isPending ? (
            <div
              className="space-y-2"
              aria-busy="true"
              aria-label="Loading economic indicators"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />{" "}
                Contacting the World Bank API…
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="h-24" />
                ))}
              </div>
            </div>
          ) : isError || !data ? (
            <div
              role="alert"
              className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning"
            >
              <p className="flex items-center gap-1.5 font-medium">
                <TriangleAlert className="size-3.5" aria-hidden /> Economic
                indicators are unavailable
              </p>
              <p className="mt-1 text-muted">
                {error instanceof Error
                  ? error.message
                  : "The World Bank API could not be reached."}{" "}
                No figures are shown rather than showing anything unverified.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                <RefreshCw
                  className={cn(isFetching && "animate-spin")}
                  aria-hidden
                />{" "}
                Retry
              </Button>
            </div>
          ) : (
            <>
              {data.stale ? (
                <p
                  role="status"
                  className="rounded border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[10.5px] text-warning"
                >
                  Some series are saved copies because the World Bank API could
                  not be refreshed.
                </p>
              ) : null}
              {failed > 0 ? (
                <p
                  role="status"
                  className="rounded border border-line bg-panel-2 px-2.5 py-1.5 text-[10.5px] text-muted"
                >
                  {failed} of {data.indicators.length} indicators could not be
                  retrieved and are marked below.
                </p>
              ) : null}
              <ul
                className="grid grid-cols-2 gap-2 md:grid-cols-4"
                aria-label="National economic indicators"
              >
                {data.indicators.map((item) => (
                  <IndicatorCard
                    key={item.code}
                    item={item}
                    selected={selected?.code === item.code}
                    onSelect={() => item.latest && setSelectedCode(item.code)}
                  />
                ))}
              </ul>
              {selected ? <TrendPanel item={selected} /> : null}
              <p className="font-mono text-[8.5px] uppercase tracking-[0.05em] text-faint">
                Source: {data.source.name} · {data.source.dataset} · retrieved{" "}
                {formatDateTime(data.retrievedAt)} · annual data lags the
                current year by design
              </p>
            </>
          )}

          <section
            aria-label="Economy and business reports"
            className="rounded-md border border-line bg-panel-2/30 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-medium text-ink">
                {categoryConfig("economy").label} reports
              </h3>
              {allDemo ? <Badge variant="demo">Demo data</Badge> : null}
              <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-warning/80">
                News-derived · not economic statistics
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setFilter("category", "economy");
                  setOpen(false);
                }}
              >
                Filter the feed to economy
              </Button>
            </div>
            <p className="mt-1 text-[10.5px] text-muted">
              {formatNumber(economyEvents.length)} reported economy &amp;
              business events in the loaded dataset. Counts reflect reporting
              volume, not economic size or performance.
            </p>
            <ul
              className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6"
              aria-label="Economy reports by zone"
            >
              {byZone.map(({ zone, count }) => (
                <li
                  key={zone}
                  className="rounded border border-line bg-canvas-2/60 px-2 py-1.5"
                >
                  <p className="font-mono text-[8px] uppercase tracking-[0.06em] text-faint">
                    {zoneConfig(zone).shortName}
                  </p>
                  <p className="font-mono text-[14px] tabular text-ink">
                    {count}
                  </p>
                </li>
              ))}
            </ul>
            {economyEvents.length === 0 ? (
              <p className="mt-2 text-[10.5px] text-muted">
                No economy reports in the loaded dataset.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line/60">
                {economyEvents.slice(0, 5).map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        selectEvent(event.id);
                      }}
                      className="flex w-full items-baseline gap-2 py-1.5 text-left text-[11px] text-ink hover:text-info focus-visible:outline-2 focus-visible:outline-info"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {event.title}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-faint">
                        {event.stateName ?? "National"} ·{" "}
                        {relativeTime(event.lastUpdatedAt, referenceTime)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.05em] text-faint">
              Latest as of {formatDate(referenceTime)}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
