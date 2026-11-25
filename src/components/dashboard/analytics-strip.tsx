"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Info, WifiOff } from "lucide-react";
import { categoryConfig } from "@/lib/config";
import { formatNumber, formatPercent } from "@/lib/format";
import {
  trendSeries,
  type NationalSummary,
  type TrendPoint,
} from "@/lib/intelligence";
import { useDashboardStore } from "@/lib/store";
import type { IntelligenceEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
const TrendChart = dynamic(
  () =>
    import("@/components/dashboard/trend-chart").then(
      (module) => module.TrendChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center">
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
          Loading trend…
        </p>
      </div>
    ),
  },
);

function Panel({
  title,
  note,
  action,
  children,
  className,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-canvas/55 px-2.5 py-2",
        className,
      )}
    >
      <div className="mb-1.5 flex shrink-0 items-center gap-1">
        <h3 className="truncate font-mono text-[8.5px] uppercase tracking-[0.13em] text-faint">
          {title}
        </h3>
        {note ? (
          <span className="truncate font-mono text-[7.5px] text-faint/70">
            {note}
          </span>
        ) : null}
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function LiteTrend({ series }: { series: TrendPoint[] }) {
  const L = useDatasetLabels();
  const max = Math.max(1, ...series.map((point) => point.total));
  const total = series.reduce((sum, point) => sum + point.total, 0);
  const first = series[0];
  const last = series.at(-1);
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-end gap-1 border-b border-line/80">
        {series.map((point) => (
          <div
            key={point.day}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${point.label}: ${point.total} reported ${point.total === 1 ? L.event : L.events}`}
          >
            <span
              className="block w-full rounded-t-[2px] bg-info/65 transition-colors group-hover:bg-info"
              style={{
                height:
                  point.total === 0
                    ? 0
                    : `${Math.max(4, (point.total / max) * 100)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex shrink-0 items-center justify-between font-mono text-[7px] text-faint">
        <span>{first?.label}</span>
        <span className="text-muted">{formatNumber(total)} in view</span>
        <span>{last?.label}</span>
      </div>
    </div>
  );
}

function TrendPanel({
  series,
  liteMode,
}: {
  series: TrendPoint[];
  liteMode: boolean;
}) {
  const peak = Math.max(0, ...series.map((point) => point.total));
  return (
    <Panel
      title="Reported-volume trend"
      note="14 daily buckets · occurrence time"
      action={
        <span className="font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
          peak {formatNumber(peak)}
        </span>
      }
      className="xl:col-span-1"
    >
      <div className="h-full min-h-[104px]">
        {liteMode ? (
          <LiteTrend series={series} />
        ) : (
          <TrendChart data={series} />
        )}
      </div>
      <div className="mt-1 flex items-center gap-3 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-info" aria-hidden />{" "}
          Reported
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-warning" aria-hidden />{" "}
          Severity 4–5
        </span>
        {liteMode ? (
          <span className="ml-auto flex items-center gap-1 text-positive/80">
            <WifiOff className="size-2" aria-hidden /> Lite
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function CategoryPanel({ summary }: { summary: NationalSummary }) {
  const rows = summary.categories.filter((row) => row.count > 0).slice(0, 6);
  return (
    <Panel title="Category mix" note="share of reported events">
      {rows.length === 0 ? (
        <p className="text-[9.5px] text-faint">No categories in view.</p>
      ) : (
        <div className="space-y-[5px]">
          {rows.map((row) => (
            <div key={row.category} className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="w-[70px] shrink-0 truncate text-[9.5px] text-muted">
                {categoryConfig(row.category).shortLabel}
              </span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-canvas-2">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(2, row.share * 100)}%`,
                    backgroundColor: row.color,
                  }}
                />
              </span>
              <span className="w-5 shrink-0 text-right font-mono text-[8.5px] tabular text-ink">
                {row.count}
              </span>
              <span className="w-7 shrink-0 text-right font-mono text-[7.5px] tabular text-faint">
                {formatPercent(row.share)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function StatePanel({ summary }: { summary: NationalSummary }) {
  const selectState = useDashboardStore((state) => state.selectState);
  const setMobileView = useDashboardStore((state) => state.setMobileView);
  return (
    <Panel title="Reported volume by state" note="top 5">
      {summary.topStates.length === 0 ? (
        <p className="text-[9.5px] text-faint">
          No state-level records in view.
        </p>
      ) : (
        <div className="space-y-[5px]">
          {summary.topStates.slice(0, 5).map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => {
                selectState(state.id);
                setMobileView("brief");
              }}
              className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-px text-left transition-colors hover:bg-panel-2/70 focus-visible:outline-2 focus-visible:outline-info"
              aria-label={`Open ${state.name} state brief: ${state.count} reported events`}
            >
              <span className="w-[66px] shrink-0 truncate text-[9.5px] text-muted">
                {state.name}
              </span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-canvas-2">
                <span
                  className="block h-full rounded-full bg-info/65"
                  style={{ width: `${Math.max(3, state.share * 100)}%` }}
                />
              </span>
              <span className="w-4 shrink-0 text-right font-mono text-[8.5px] tabular text-ink">
                {state.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EvidencePanel({ summary }: { summary: NationalSummary }) {
  const setMethodologyOpen = useDashboardStore(
    (state) => state.setMethodologyOpen,
  );
  const rows = [
    {
      label: "Corroborated / official",
      value: summary.totals.corroborated,
      color: "#20C997",
    },
    { label: "Disputed", value: summary.totals.disputed, color: "#FFB020" },
    {
      label: "Single source",
      value: summary.totals.singleSource,
      color: "#8492A8",
    },
    { label: "Unassessed", value: summary.totals.unassessed, color: "#64748B" },
  ];
  return (
    <Panel
      title="Evidence & coverage"
      action={
        <button
          type="button"
          onClick={() => setMethodologyOpen(true)}
          className="inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-info"
        >
          <Info className="size-2.5" aria-hidden /> Notes
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center gap-1 rounded border border-line/70 bg-canvas-2/60 px-1.5 py-1"
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className="truncate text-[8.5px] text-muted">
              {row.label}
            </span>
            <span className="ml-auto font-mono text-[8.5px] tabular text-ink">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between border-t border-line/70 pt-1 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
        <span>Independent source groups</span>
        <span className="tabular text-muted">
          {summary.totals.independentSourceGroups}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
        <span>National-scope records</span>
        <span className="tabular text-muted">
          {summary.totals.nationalEvents}
        </span>
      </div>
    </Panel>
  );
}

export function AnalyticsStrip({
  events,
  summary,
  referenceTime,
  liteMode,
  variant = "desktop",
}: {
  events: IntelligenceEvent[];
  summary: NationalSummary;
  referenceTime: string;
  liteMode: boolean;
  variant?: "desktop" | "mobile";
}) {
  const L = useDatasetLabels();
  const [collapsed, setCollapsed] = useState(false);
  const setMethodologyOpen = useDashboardStore(
    (state) => state.setMethodologyOpen,
  );
  const series = useMemo(
    () => trendSeries(events, referenceTime, 14),
    [events, referenceTime],
  );

  const header = (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2.5">
      <BarChart3 className="size-3 text-info" aria-hidden />
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink">
        National analytics
      </h2>
      <span className="hidden truncate font-mono text-[8px] uppercase tracking-[0.06em] text-faint sm:inline">
        {summary.scopeLabel}
      </span>
      <span className="ml-auto flex items-center gap-1.5 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
        <span className="size-1 rounded-full bg-warning" aria-hidden />
        Volume · not risk
      </span>
      {variant === "desktop" ? (
        <>
          <button
            type="button"
            onClick={() => setMethodologyOpen(true)}
            className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint transition-colors hover:text-ink sm:inline-flex"
          >
            Data notes
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="grid size-5 place-items-center rounded border border-line text-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-info"
            aria-label={collapsed ? "Expand analytics" : "Collapse analytics"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronUp className="size-3" aria-hidden />
            ) : (
              <ChevronDown className="size-3" aria-hidden />
            )}
          </button>
        </>
      ) : null}
    </div>
  );

  if (variant === "mobile") {
    return (
      <section
        aria-label="National analytics"
        className="nsm-scroll flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-panel/20"
      >
        {header}
        <div className="space-y-2 p-2">
          <div className="h-[190px] overflow-hidden rounded-md border border-line bg-canvas/40">
            <TrendPanel series={series} liteMode={liteMode} />
          </div>
          <div className="rounded-md border border-line bg-canvas/40">
            <CategoryPanel summary={summary} />
          </div>
          <div className="rounded-md border border-line bg-canvas/40">
            <StatePanel summary={summary} />
          </div>
          <div className="rounded-md border border-line bg-canvas/40">
            <EvidencePanel summary={summary} />
          </div>
          <div className="rounded border border-warning/25 bg-warning/5 px-2.5 py-2 text-[9px] leading-relaxed text-warning/85">
            {L.isDemo ? "Static fictional demo snapshot. " : ""}Reported events
            are not a measure of incidence, risk, danger or state safety, and
            the dataset has no historical completeness.
          </div>
          <p className="pb-1 text-right font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
            Reference {referenceTime}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="National analytics"
      className="hidden shrink-0 flex-col border-t border-line bg-panel/15 lg:flex"
    >
      {header}
      {collapsed ? null : (
        <div className="grid h-[168px] grid-cols-2 gap-px bg-line xl:grid-cols-[1.55fr_1fr_1fr_1fr]">
          <TrendPanel series={series} liteMode={liteMode} />
          <CategoryPanel summary={summary} />
          <StatePanel summary={summary} />
          <EvidencePanel summary={summary} />
        </div>
      )}
    </section>
  );
}
