"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  History as HistoryIcon,
  Info,
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
import { Input, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { CATEGORIES, VERIFICATION_CONFIG, ZONES } from "@/lib/config";
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  lagosDayKey,
} from "@/lib/format";
import { STATES } from "@/lib/geo/states";
import type { HistoryResult } from "@/lib/intelligence/history";
import { useDashboardStore } from "@/lib/store";
import type { Category, ZoneId } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "365d", label: "365 days" },
  { id: "all", label: "All available" },
] as const;

type RangeMode =
  | { kind: "window"; window: (typeof PRESETS)[number]["id"] }
  | { kind: "custom"; from: string; to: string };

interface Params {
  mode: RangeMode;
  stateId: string;
  zone: string;
  category: string;
}

function toQuery(params: Params): string {
  const query = new URLSearchParams();
  if (params.mode.kind === "custom") {
    query.set("from", params.mode.from);
    query.set("to", params.mode.to);
  } else {
    query.set("window", params.mode.window);
  }
  if (params.stateId) query.set("state", params.stateId);
  else if (params.zone) query.set("zone", params.zone);
  if (params.category) query.set("category", params.category);
  return query.toString();
}

async function fetchHistory(
  query: string,
  signal: AbortSignal,
): Promise<HistoryResult> {
  const response = await fetch(`/api/intelligence/history?${query}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      body?.error?.message ?? `History unavailable (${response.status})`,
    );
  }
  return ((await response.json()) as { data: HistoryResult }).data;
}

/** Consecutive runs of unobserved buckets, as [firstStart, lastStart] pairs. */
function unobservedSegments(
  series: HistoryResult["series"],
): Array<[string, string]> {
  const segments: Array<[string, string]> = [];
  let open: [string, string] | null = null;
  for (const point of series) {
    if (point.observed) {
      open = null;
    } else if (open) {
      open[1] = point.start;
    } else {
      open = [point.start, point.start];
      segments.push(open);
    }
  }
  return segments;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded border border-line bg-panel-2/40 px-2.5 py-2">
      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
        {label}
      </p>
      <p className="font-mono text-[17px] tabular text-ink">{value}</p>
      {hint ? (
        <p className="font-mono text-[8.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function HistoryDialog({ referenceTime }: { referenceTime: string }) {
  const open = useDashboardStore((state) => state.historyOpen);
  const setOpen = useDashboardStore((state) => state.setHistoryOpen);
  const selectEvent = useDashboardStore((state) => state.selectEvent);

  const today = lagosDayKey(referenceTime);
  const [params, setParams] = useState<Params>({
    mode: { kind: "window", window: "90d" },
    stateId: "",
    zone: "",
    category: "",
  });
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);

  // Start from whatever the dashboard is currently scoped to each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const state = useDashboardStore.getState().filters;
    setParams((current) => ({
      ...current,
      stateId: state.stateId ?? "",
      zone: state.stateId ? "" : state.zone === "all" ? "" : state.zone,
      category: state.category === "all" ? "" : state.category,
    }));
  }, [open]);

  const query = toQuery(params);
  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["history", query],
    queryFn: ({ signal }) => fetchHistory(query, signal),
    enabled: open,
    staleTime: 30_000,
    retry: 1,
  });

  const customInvalid = customFrom > customTo;
  const activePreset =
    params.mode.kind === "window" ? params.mode.window : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-5xl overflow-hidden p-0"
        aria-describedby="history-description"
      >
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <HistoryIcon className="size-4 text-info" aria-hidden />
            Historical intelligence
          </DialogTitle>
          <DialogDescription
            id="history-description"
            className="mt-1 text-[10.5px]"
          >
            Explore reported events over any period for the whole country, a
            geopolitical zone or a single state. Counts are reporting volume,
            not incidence or risk, and days outside the held records are
            unobserved, not quiet.
          </DialogDescription>

          <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-2">
            <div
              role="group"
              aria-label="Time range presets"
              className="flex flex-wrap gap-1"
            >
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant={activePreset === preset.id ? "primary" : "outline"}
                  size="xs"
                  aria-pressed={activePreset === preset.id}
                  onClick={() =>
                    setParams((current) => ({
                      ...current,
                      mode: { kind: "window", window: preset.id },
                    }))
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-1.5">
              <label className="text-[9px] uppercase tracking-[0.06em] text-faint">
                From
                <Input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="mt-0.5 h-7 w-[8.5rem] text-[11px]"
                  aria-label="Start date"
                />
              </label>
              <label className="text-[9px] uppercase tracking-[0.06em] text-faint">
                To
                <Input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="mt-0.5 h-7 w-[8.5rem] text-[11px]"
                  aria-label="End date"
                />
              </label>
              <Button
                variant={
                  params.mode.kind === "custom" ? "primary" : "secondary"
                }
                size="sm"
                disabled={customInvalid || !customFrom || !customTo}
                onClick={() =>
                  setParams((current) => ({
                    ...current,
                    mode: { kind: "custom", from: customFrom, to: customTo },
                  }))
                }
              >
                Apply dates
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <NativeSelect
                aria-label="State"
                value={params.stateId}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    stateId: event.target.value,
                    zone: "",
                  }))
                }
              >
                <option value="">All states</option>
                {[...STATES]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Geopolitical zone"
                value={params.zone}
                disabled={Boolean(params.stateId)}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    zone: event.target.value as ZoneId | "",
                  }))
                }
              >
                <option value="">All zones</option>
                {ZONES.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Category"
                value={params.category}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    category: event.target.value as Category | "",
                  }))
                }
              >
                <option value="">All categories</option>
                {CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.shortLabel}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {customInvalid ? (
            <p role="alert" className="mt-1.5 text-[10px] text-warning">
              The start date must not be after the end date.
            </p>
          ) : null}
        </div>

        <div className="nsm-scroll max-h-[68dvh] space-y-3 overflow-y-auto p-3">
          {isPending ? (
            <div
              aria-busy="true"
              aria-label="Loading history"
              className="space-y-2"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />{" "}
                Loading history…
              </div>
              <Skeleton className="h-52 w-full" />
            </div>
          ) : isError || !data ? (
            <div
              role="alert"
              className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning"
            >
              <p className="flex items-center gap-1.5 font-medium">
                <TriangleAlert className="size-3.5" aria-hidden /> History could
                not be loaded
              </p>
              <p className="mt-1 text-muted">
                {error instanceof Error ? error.message : "Unknown error."}
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
              <p
                role="status"
                data-testid="history-coverage"
                className={cn(
                  "flex items-start gap-1.5 rounded border px-2.5 py-1.5 text-[10.5px]",
                  data.coverage.partial
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-line bg-panel-2/60 text-muted",
                )}
              >
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">
                    {data.coverage.label}.
                  </strong>{" "}
                  {data.coverage.note}
                </span>
              </p>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <span className="text-ink">{data.scope.label}</span>
                <span className="font-mono text-[9.5px]">
                  {data.range.from} → {data.range.to} ({data.days} day
                  {data.days === 1 ? "" : "s"}, by {data.bucket})
                </span>
                {data.coverage.basis === "demo_snapshot" ? (
                  <Badge variant="demo">Demo data</Badge>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat
                  label="Reported events"
                  value={formatNumber(data.totals.events)}
                />
                <Stat
                  label="Severity 4–5"
                  value={formatNumber(data.totals.severity4Plus)}
                />
                <Stat
                  label="Corroborated+"
                  value={formatNumber(data.totals.corroborated)}
                />
                <Stat
                  label="States reporting"
                  value={formatNumber(data.totals.statesReporting)}
                />
                <Stat
                  label="vs previous period"
                  value={`${data.delta.events > 0 ? "+" : data.delta.events < 0 ? "−" : ""}${Math.abs(data.delta.events)}`}
                  hint={
                    !data.previous.comparable
                      ? "Not like-for-like: earlier period is partly unobserved"
                      : data.delta.percent === null
                        ? "No events in previous period"
                        : formatPercent(data.delta.percent)
                  }
                />
              </div>

              <section
                aria-label="Event volume over time"
                className="rounded-md border border-line bg-panel-2/30 p-3"
              >
                <h3 className="text-[12px] font-medium text-ink">
                  Reported volume over time
                </h3>
                <div className="mt-2 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.series}
                      margin={{ top: 6, right: 6, bottom: 0, left: -18 }}
                    >
                      <CartesianGrid
                        stroke="#1b2638"
                        strokeDasharray="2 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="start"
                        tickFormatter={(value: string) =>
                          data.series.find((point) => point.start === value)
                            ?.label ?? value
                        }
                        tick={{ fill: "#64748b", fontSize: 8 }}
                        tickLine={false}
                        axisLine={{ stroke: "#202b3d" }}
                        interval="preserveStartEnd"
                        minTickGap={18}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={34}
                        tick={{ fill: "#64748b", fontSize: 8 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0a0f1b",
                          border: "1px solid #2b3a51",
                          fontSize: 11,
                        }}
                        labelFormatter={(value) => {
                          const point = data.series.find(
                            (item) => item.start === value,
                          );
                          return `${point?.label ?? value} (${data.bucket})${point && !point.observed ? " · unobserved" : ""}`;
                        }}
                      />
                      {unobservedSegments(data.series).map(
                        ([from, to], index) => (
                          <ReferenceArea
                            key={from}
                            x1={from}
                            x2={to}
                            fill="#ffb020"
                            fillOpacity={0.08}
                            stroke="#ffb020"
                            strokeOpacity={0.25}
                            strokeDasharray="3 3"
                            label={
                              index === 0
                                ? {
                                    value: "Unobserved",
                                    fill: "#ffb020",
                                    fontSize: 8,
                                    position: "insideTop",
                                  }
                                : undefined
                            }
                          />
                        ),
                      )}
                      <Bar
                        dataKey="total"
                        name="Reported events"
                        fill="#35bdf2"
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="severity4Plus"
                        name="Severity 4–5"
                        fill="#ffb020"
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.05em] text-faint">
                  Reported volume · not incidence · shaded periods are
                  unobserved, not quiet
                </p>
              </section>

              <div className="grid gap-3 md:grid-cols-2">
                <section
                  aria-label="Category breakdown"
                  className="rounded-md border border-line bg-panel-2/30 p-3"
                >
                  <h3 className="text-[12px] font-medium text-ink">
                    By category
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {data.categories.map((row) => (
                      <li key={row.category} className="text-[10.5px]">
                        <div className="flex justify-between text-muted">
                          <span>{row.label}</span>
                          <span className="font-mono tabular text-ink">
                            {row.count}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1 rounded bg-panel-3">
                          <div
                            className="h-1 rounded"
                            style={{
                              width: `${Math.round(row.share * 100)}%`,
                              backgroundColor: row.color,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section
                  aria-label="Most reported states"
                  className="rounded-md border border-line bg-panel-2/30 p-3"
                >
                  <h3 className="text-[12px] font-medium text-ink">
                    Most reported states
                  </h3>
                  {data.topStates.length === 0 ? (
                    <p className="mt-2 text-[10.5px] text-muted">
                      No state-level reports in this range.
                    </p>
                  ) : (
                    <ol className="mt-2 space-y-1">
                      {data.topStates.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between text-[11px]"
                        >
                          <button
                            type="button"
                            className="text-left text-muted hover:text-info focus-visible:outline-2 focus-visible:outline-info"
                            onClick={() =>
                              setParams((current) => ({
                                ...current,
                                stateId: row.id,
                                zone: "",
                              }))
                            }
                          >
                            {row.name}
                          </button>
                          <span className="font-mono tabular text-ink">
                            {row.count}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.05em] text-warning/80">
                    Volume · not risk
                  </p>
                </section>
              </div>

              <section
                aria-label="Timeline of notable events"
                className="rounded-md border border-line bg-panel-2/30 p-3"
              >
                <h3 className="text-[12px] font-medium text-ink">
                  Timeline of notable events
                </h3>
                <p className="text-[10px] text-muted">
                  Severity 4–5 or corroborated reports, newest first (up to 40).
                </p>
                {data.timeline.length === 0 ? (
                  <p className="mt-2 text-[10.5px] text-muted">
                    No notable events in this range and scope.
                  </p>
                ) : (
                  <ol className="mt-2 divide-y divide-line/60">
                    {data.timeline.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            selectEvent(entry.id);
                          }}
                          className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-left hover:text-info focus-visible:outline-2 focus-visible:outline-info"
                        >
                          <span className="w-28 shrink-0 font-mono text-[9px] text-faint">
                            {formatDateTime(entry.at)}
                          </span>
                          <span className="min-w-0 flex-1 text-[11px] text-ink">
                            {entry.title}
                          </span>
                          <span className="font-mono text-[9px] uppercase text-muted">
                            {entry.categoryLabel} · S{entry.severity} ·{" "}
                            {entry.stateName ?? "National"} ·{" "}
                            {
                              VERIFICATION_CONFIG[entry.verificationStatus]
                                .label
                            }
                          </span>
                          {entry.isDemo ? (
                            <Badge variant="demo" className="text-[8px]">
                              Demo
                            </Badge>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
