"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CircleSlash,
  Filter,
  Layers,
  Loader2,
  MapPin,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { EventCardMini } from "@/components/dashboard/event-card";
import {
  SOURCE_TIER_LABELS,
  categoryConfig,
  withAlpha,
  zoneConfig,
} from "@/lib/config";
import { formatNumber, formatPercent, relativeTime } from "@/lib/format";
import type {
  RegionalIntelligence,
  TrendPoint,
  ZoneComparison,
  ZoneProfile,
} from "@/lib/intelligence";
import { useDashboardStore } from "@/lib/store";
import {
  REGIONAL_TREND_DAYS,
  type Filters,
  type RegionalTrendDays,
  type ZoneId,
} from "@/lib/types";
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

type ComparisonMetric = "volume" | "high" | "corroborated" | "coverage";

const COMPARISON_METRICS: Array<{ id: ComparisonMetric; label: string }> = [
  { id: "volume", label: "Volume" },
  { id: "high", label: "High 4–5" },
  { id: "corroborated", label: "Corroborated" },
  { id: "coverage", label: "Coverage" },
];

function regionalParams(
  filters: Filters,
  zone: ZoneId | null,
  days: RegionalTrendDays,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.window !== "all") params.set("window", filters.window);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.severity !== "all")
    params.set("severity", String(filters.severity));
  if (filters.verification !== "all")
    params.set("verification", filters.verification);
  if (filters.q) params.set("q", filters.q);
  if (zone) params.set("zone", zone);
  params.set("days", String(days));
  return params;
}

async function fetchRegional(
  filters: Filters,
  zone: ZoneId | null,
  days: RegionalTrendDays,
  signal: AbortSignal,
): Promise<RegionalIntelligence> {
  const response = await fetch(
    `/api/intelligence/regional?${regionalParams(filters, zone, days).toString()}`,
    {
      headers: { accept: "application/json" },
      signal,
    },
  );
  if (!response.ok)
    throw new Error(`Regional request failed (${response.status})`);
  const payload = (await response.json()) as { data: RegionalIntelligence };
  return payload.data;
}

function share(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function metricValue(zone: ZoneComparison, metric: ComparisonMetric): number {
  switch (metric) {
    case "high":
      return share(zone.severity4Plus, zone.reportedEvents);
    case "corroborated":
      return share(zone.corroborated, zone.reportedEvents);
    case "coverage":
      return share(zone.statesReporting, zone.statesTotal);
    case "volume":
    default:
      return zone.reportedEvents;
  }
}

function metricPrimary(zone: ZoneComparison, metric: ComparisonMetric): string {
  switch (metric) {
    case "high":
      return formatPercent(share(zone.severity4Plus, zone.reportedEvents));
    case "corroborated":
      return formatPercent(share(zone.corroborated, zone.reportedEvents));
    case "coverage":
      return `${zone.statesReporting}/${zone.statesTotal}`;
    case "volume":
    default:
      return formatNumber(zone.reportedEvents);
  }
}

function Sparkline({ points, color }: { points: TrendPoint[]; color: string }) {
  const max = Math.max(1, ...points.map((point) => point.total));
  return (
    <span className="flex h-4 w-full items-end gap-[1px]" aria-hidden>
      {points.map((point) => (
        <span
          key={point.day}
          className="min-w-0 flex-1 rounded-t-[1px]"
          style={{
            height:
              point.total === 0
                ? "1px"
                : `${Math.max(12, (point.total / max) * 100)}%`,
            backgroundColor: point.total === 0 ? "#202b3d" : color,
            opacity: point.total === 0 ? 1 : 0.78,
          }}
        />
      ))}
    </span>
  );
}

function LiteTrend({
  series,
  accent,
}: {
  series: TrendPoint[];
  accent: string;
}) {
  const L = useDatasetLabels();
  const max = Math.max(1, ...series.map((point) => point.total));
  const total = series.reduce((sum, point) => sum + point.total, 0);
  const first = series[0];
  const last = series.at(-1);
  return (
    <div
      className="flex h-full flex-col"
      role="img"
      aria-label={`Daily reported ${L.event} volume. ${formatNumber(total)} events across ${series.length} days. Values: ${series
        .map((point) => `${point.label} ${point.total}`)
        .join(", ")}.`}
    >
      <div className="flex min-h-0 flex-1 items-end gap-1 border-b border-line/80">
        {series.map((point) => (
          <div
            key={point.day}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${point.label}: ${point.total} reported ${point.total === 1 ? L.event : L.events}`}
          >
            <span
              className="block w-full rounded-t-[2px] transition-opacity group-hover:opacity-100"
              style={{
                height:
                  point.total === 0
                    ? 0
                    : `${Math.max(4, (point.total / max) * 100)}%`,
                backgroundColor: accent,
                opacity: 0.7,
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
    <section
      className={cn(
        "min-w-0 rounded-md border border-line bg-canvas/50",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-line/70 px-2.5 py-1.5">
        <h4 className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
          {title}
        </h4>
        {note ? (
          <span className="truncate font-mono text-[7.5px] text-faint/80">
            {note}
          </span>
        ) : null}
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
      </div>
      <div className="px-2.5 py-2">{children}</div>
    </section>
  );
}

function ComparisonRow({
  zone,
  metric,
  selected,
  onSelect,
}: {
  zone: ZoneComparison;
  metric: ComparisonMetric;
  selected: boolean;
  onSelect: () => void;
}) {
  const L = useDatasetLabels();
  const highShare = share(zone.severity4Plus, zone.reportedEvents);
  const corroboratedShare = share(zone.corroborated, zone.reportedEvents);
  return (
    <button
      type="button"
      data-testid={`regional-zone-${zone.zone}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${zone.name}: ${zone.reportedEvents} reported ${L.events}, ${formatPercent(
        highShare,
      )} high severity, ${formatPercent(corroboratedShare)} corroborated or officially confirmed, ${
        zone.statesReporting
      } of ${zone.statesTotal} states reporting. Open zone profile.`}
      className={cn(
        "group flex w-full items-center gap-2 border-b border-line/60 px-2.5 py-2 text-left transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-info",
        selected ? "bg-panel-3/70" : "hover:bg-panel-2/50",
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: zone.color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[11.5px] font-medium text-ink">
            {zone.name}
          </span>
          <span className="font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
            {zone.shortName}
          </span>
          {selected ? (
            <Check className="size-2.5 text-info" aria-hidden />
          ) : null}
        </span>
        <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-canvas-2">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.max(zone.reportedEvents > 0 ? 2 : 0, zone.share * 100)}%`,
              backgroundColor: zone.color,
            }}
          />
        </span>
      </span>

      <span className="w-12 shrink-0 text-right font-mono text-[8.5px] tabular text-faint sm:hidden">
        {metricPrimary(zone, metric)}
      </span>

      <span className="hidden w-14 shrink-0 text-right font-mono text-[11px] tabular text-ink sm:block">
        {formatNumber(zone.reportedEvents)}
      </span>
      <span className="hidden w-12 shrink-0 text-right font-mono text-[9px] tabular text-muted sm:block">
        {formatPercent(highShare)}
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-[9px] tabular text-muted sm:block">
        {formatPercent(corroboratedShare)}
      </span>
      <span className="hidden w-12 shrink-0 text-right font-mono text-[9px] tabular text-muted sm:block">
        {zone.statesReporting}/{zone.statesTotal}
      </span>
      <span className="hidden w-14 shrink-0 md:block">
        <Sparkline points={zone.trend} color={zone.color} />
      </span>
      <ArrowRight
        className="size-3 shrink-0 text-faint/40 transition-colors group-hover:text-info"
        aria-hidden
      />
    </button>
  );
}

function ZoneSelector({
  zones,
  selectedZone,
  onSelect,
}: {
  zones: ZoneComparison[];
  selectedZone: ZoneId | null;
  onSelect: (zone: ZoneId) => void;
}) {
  const L = useDatasetLabels();
  return (
    <nav
      aria-label="Zone profiles"
      className="nsm-scroll flex gap-1 overflow-x-auto border-b border-line bg-panel-2/25 px-2.5 py-2"
    >
      {zones.map((zone) => {
        const selected = selectedZone === zone.zone;
        return (
          <button
            key={zone.zone}
            type="button"
            onClick={() => onSelect(zone.zone)}
            aria-pressed={selected}
            aria-label={`${zone.name} zone profile: ${zone.reportedEvents} reported ${L.events}`}
            className={cn(
              "flex min-w-[118px] shrink-0 flex-col rounded-md border bg-canvas/55 px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info",
              selected
                ? "border-line-2 bg-panel-3 text-ink"
                : "border-line text-muted hover:border-line-2 hover:text-ink",
            )}
            style={
              selected
                ? { borderColor: withAlpha(zone.color, 0.65) }
                : undefined
            }
          >
            <span className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: zone.color }}
                aria-hidden
              />
              <span className="truncate text-[10.5px] font-medium">
                {zone.name}
              </span>
              <span className="ml-auto font-mono text-[7px] uppercase tracking-[0.05em] text-faint">
                {zone.shortName}
              </span>
            </span>
            <span className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-[13px] tabular text-ink">
                {formatNumber(zone.reportedEvents)}
              </span>
              <span className="font-mono text-[7px] uppercase tracking-[0.05em] text-faint">
                reported
              </span>
              <span className="ml-auto font-mono text-[8px] tabular text-faint">
                {formatPercent(zone.share)}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function ComparisonSection({
  data,
  selectedZone,
  onSelect,
}: {
  data: RegionalIntelligence;
  selectedZone: ZoneId | null;
  onSelect: (zone: ZoneId) => void;
}) {
  const L = useDatasetLabels();
  const [metric, setMetric] = useState<ComparisonMetric>("volume");
  const sorted = useMemo(
    () =>
      [...data.zones].sort(
        (a, b) =>
          metricValue(b, metric) - metricValue(a, metric) ||
          b.reportedEvents - a.reportedEvents ||
          a.name.localeCompare(b.name),
      ),
    [data.zones, metric],
  );

  return (
    <section
      aria-labelledby="regional-comparison-heading"
      className="border-b border-line px-3 py-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <h3
            id="regional-comparison-heading"
            className="text-[12px] font-semibold tracking-[0.02em] text-ink"
          >
            Zone comparison
          </h3>
          <p className="mt-0.5 max-w-xl text-[9.5px] leading-relaxed text-muted">
            All six zones under the active category, severity, verification,
            search and time filters. A selected dashboard state is excluded so
            every zone stays comparable. Ordering is descriptive, never a risk
            or safety ranking.
          </p>
        </div>
        <div
          role="group"
          aria-label="Comparison ordering metric"
          className="ml-auto flex flex-wrap items-center gap-0.5 rounded border border-line bg-canvas-2 p-0.5"
        >
          {COMPARISON_METRICS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMetric(option.id)}
              aria-pressed={metric === option.id}
              className={cn(
                "rounded-sm px-1.5 py-0.5 font-mono text-[7.5px] uppercase tracking-[0.05em] transition-colors focus-visible:outline-2 focus-visible:outline-info",
                metric === option.id
                  ? "bg-panel-3 text-ink"
                  : "text-faint hover:text-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
        <span>{formatNumber(data.zonalTotal)} zoned records</span>
        <span className="text-line-2">·</span>
        <span>
          {formatNumber(data.nationalEvents)} national-scope records excluded
        </span>
        <span className="text-line-2">·</span>
        <span className="text-warning/80">Reported volume · not risk</span>
      </p>

      <div className="mt-2 overflow-hidden rounded-md border border-line/80">
        <div className="hidden items-center gap-2 border-b border-line bg-panel-2/45 px-2.5 py-1 font-mono text-[7px] uppercase tracking-[0.06em] text-faint sm:flex">
          <span className="min-w-0 flex-1">Zone · share of zoned volume</span>
          <span className="w-14 text-right">Events</span>
          <span className="w-12 text-right">High 4–5</span>
          <span className="w-14 text-right">Corroborated</span>
          <span className="w-12 text-right">States</span>
          <span className="hidden w-14 text-right md:block">{data.days}D</span>
          <span className="w-3 shrink-0" />
        </div>
        {sorted.map((zone) => (
          <ComparisonRow
            key={zone.zone}
            zone={zone}
            metric={metric}
            selected={selectedZone === zone.zone}
            onSelect={() => onSelect(zone.zone)}
          />
        ))}
      </div>

      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        High severity means reported severity 4–5. Corroborated combines
        corroborated and official confirmation. States counts show zones with at
        least one state-level {L.record}. Volume is not incidence, danger or a
        measure of safety.
      </p>
    </section>
  );
}

function TrendPanel({
  profile,
  liteMode,
  days,
  onDays,
}: {
  profile: ZoneProfile;
  liteMode: boolean;
  days: RegionalTrendDays;
  onDays: (days: RegionalTrendDays) => void;
}) {
  const L = useDatasetLabels();
  const total = profile.trend.reduce((sum, point) => sum + point.total, 0);
  const peak = Math.max(0, ...profile.trend.map((point) => point.total));
  const active = profile.trend.filter((point) => point.total > 0).length;
  return (
    <Panel
      title="Reported-volume trend"
      note={`${profile.trendDays} daily buckets · occurrence time`}
      action={
        <span
          role="group"
          aria-label="Regional trend range"
          className="flex items-center gap-0.5 rounded border border-line bg-canvas-2 p-0.5"
        >
          {REGIONAL_TREND_DAYS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDays(option)}
              aria-pressed={days === option}
              className={cn(
                "rounded-sm px-1.5 py-0.5 font-mono text-[7.5px] uppercase tracking-[0.05em] transition-colors focus-visible:outline-2 focus-visible:outline-info",
                days === option
                  ? "bg-panel-3 text-ink"
                  : "text-faint hover:text-muted",
              )}
            >
              {option}D
            </button>
          ))}
        </span>
      }
    >
      <div className="h-[164px] min-h-[120px]">
        {profile.totals.reportedEvents === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-center text-[9.5px] text-faint">
              No reported {L.events} in this zone under the active filters.
            </p>
          </div>
        ) : liteMode ? (
          <LiteTrend series={profile.trend} accent={profile.color} />
        ) : (
          <div
            role="img"
            aria-label={`Daily reported ${L.event} volume for ${profile.name}, ${total} events across ${profile.trendDays} days, peak ${peak}.`}
            className="h-full"
          >
            <TrendChart
              data={profile.trend}
              accent={profile.color}
              gradientId={`nsm-regional-${profile.zone}`}
            />
          </div>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
        <span className="flex items-center gap-1">
          <span
            className="h-0.5 w-3 rounded-full"
            style={{ backgroundColor: profile.color }}
            aria-hidden
          />{" "}
          Reported
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-warning" aria-hidden />{" "}
          Severity 4–5
        </span>
        <span className="ml-auto">
          {formatNumber(total)} in {profile.trendDays}D · peak{" "}
          {formatNumber(peak)} · active {active}D
        </span>
      </div>
    </Panel>
  );
}

function NationalComparisonPanel({ profile }: { profile: ZoneProfile }) {
  const L = useDatasetLabels();
  const rows = [
    {
      label: "High severity share",
      zone: profile.comparison.highSeverityShare,
      national: profile.comparison.nationalHighSeverityShare,
    },
    {
      label: "Corroborated share",
      zone: profile.comparison.corroboratedShare,
      national: profile.comparison.nationalCorroboratedShare,
    },
    {
      label: "Disputed share",
      zone: profile.comparison.disputedShare,
      national: profile.comparison.nationalDisputedShare,
    },
    {
      label: "State coverage",
      zone: profile.comparison.stateCoverageShare,
      national: profile.comparison.nationalStateCoverageShare,
    },
  ];
  return (
    <Panel title="Compared with all zones" note="descriptive composition">
      <div className="flex items-center gap-2 border-b border-line/60 pb-1 font-mono text-[7px] uppercase tracking-[0.06em] text-faint">
        <span className="min-w-0 flex-1" />
        <span className="w-12 text-right">Zone</span>
        <span className="w-14 text-right">National</span>
      </div>
      <div className="divide-y divide-line/50">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted">
              {row.label}
            </span>
            <span className="w-12 text-right font-mono text-[9.5px] tabular text-ink">
              {formatPercent(row.zone)}
            </span>
            <span className="w-14 text-right font-mono text-[9px] tabular text-faint">
              {formatPercent(row.national)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 space-y-0.5 border-t border-line/60 pt-1.5 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
        <p className="flex items-center justify-between gap-2">
          <span>Share of zoned records</span>
          <span className="tabular text-muted">
            {formatPercent(profile.totals.zonalShare)} · baseline 16.7%
          </span>
        </p>
        <p className="flex items-center justify-between gap-2">
          <span>Mean zoned volume per zone</span>
          <span className="tabular text-muted">
            {formatNumber(profile.comparison.zonalAverageEvents, {
              maximumFractionDigits: 1,
            })}
          </span>
        </p>
      </div>
      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        Shares use each scope’s reported {L.events} as the denominator. This is
        not a performance, danger or safety score.
      </p>
    </Panel>
  );
}

function CategoryPanel({ profile }: { profile: ZoneProfile }) {
  const L = useDatasetLabels();
  const rows = profile.categories.filter((row) => row.count > 0);
  return (
    <Panel title="Category mix" note="share of zone records">
      {rows.length === 0 ? (
        <p className="text-[9.5px] text-faint">
          No reported {L.events} in this zone under the active filters.
        </p>
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

function SeverityPanel({ profile }: { profile: ZoneProfile }) {
  const L = useDatasetLabels();
  const rows = [...profile.severity].sort((a, b) => b.severity - a.severity);
  return (
    <Panel title="Reported severity" note="reported impact field">
      <div className="space-y-[5px]">
        {rows.map((row) => (
          <div key={row.severity} className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className="w-[54px] shrink-0 text-[9.5px] text-muted">
              {row.severity} · {row.label}
            </span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-canvas-2">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(row.count > 0 ? 2 : 0, row.share * 100)}%`,
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
      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        Severity is a reported-impact field for this{" "}
        {L.isDemo ? "fictional demo" : "dataset"}, not a measured risk score.
      </p>
    </Panel>
  );
}

function EvidencePanel({ profile }: { profile: ZoneProfile }) {
  return (
    <Panel title="Evidence status" note="independent source groups">
      <div className="space-y-[5px]">
        {profile.verification.map((row) => (
          <div key={row.status} className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted">
              {row.label}
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
      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        Multiple article copies from one publisher do not count as independent
        corroboration.
      </p>
    </Panel>
  );
}

function StateCoveragePanel({
  profile,
  referenceTime,
}: {
  profile: ZoneProfile;
  referenceTime: string;
}) {
  const L = useDatasetLabels();
  const selectState = useDashboardStore((state) => state.selectState);
  const setMobileView = useDashboardStore((state) => state.setMobileView);
  const setOpen = useDashboardStore((state) => state.setRegionalOpen);
  return (
    <Panel
      title="State coverage"
      note={`${profile.totals.statesReporting}/${profile.totals.statesTotal} reporting`}
    >
      <div className="space-y-0.5">
        {profile.states.map((state) => (
          <button
            key={state.id}
            type="button"
            onClick={() => {
              selectState(state.id);
              setMobileView("brief");
              setOpen(false);
            }}
            aria-label={`Open ${state.name} state brief: ${state.count} reported ${L.events}`}
            className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1 text-left transition-colors hover:bg-panel-2/60 focus-visible:outline-2 focus-visible:outline-info"
          >
            <MapPin
              className={cn(
                "size-2.5 shrink-0",
                state.count > 0 ? "text-info/70" : "text-faint/45",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[9.5px]",
                state.count > 0 ? "text-muted" : "text-faint",
              )}
            >
              {state.name}
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[7.5px] uppercase tracking-[0.04em] text-faint">
              {state.count === 0
                ? "no record"
                : `latest ${relativeTime(state.latestReportedAt, referenceTime)}`}
            </span>
            <span className="w-5 shrink-0 text-right font-mono text-[8.5px] tabular text-ink">
              {state.count}
            </span>
            <span className="w-7 shrink-0 text-right font-mono text-[7.5px] tabular text-faint">
              {formatPercent(state.share)}
            </span>
            <ArrowRight
              className="size-2.5 shrink-0 text-faint/40"
              aria-hidden
            />
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        A state with no record is unobserved in{" "}
        {L.isDemo ? "this static demo" : "the loaded records"}, not safe.
      </p>
    </Panel>
  );
}

function RecentEventsPanel({
  profile,
  referenceTime,
}: {
  profile: ZoneProfile;
  referenceTime: string;
}) {
  const L = useDatasetLabels();
  const selectEvent = useDashboardStore((state) => state.selectEvent);
  const setOpen = useDashboardStore((state) => state.setRegionalOpen);
  return (
    <Panel title={`Latest ${L.records}`} note="most recently updated">
      {profile.recentEvents.length === 0 ? (
        <p className="text-[9.5px] text-faint">
          No reported {L.events} in this zone under the active filters.
        </p>
      ) : (
        <div className="divide-y divide-line/50">
          {profile.recentEvents.map((event) => (
            <EventCardMini
              key={event.id}
              event={event}
              referenceTime={referenceTime}
              onOpen={(eventId) => {
                selectEvent(eventId);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        Selecting a record opens its full {L.isDemo ? "demo " : ""}evidence
        view.
      </p>
    </Panel>
  );
}

function SourcesPanel({ profile }: { profile: ZoneProfile }) {
  const L = useDatasetLabels();
  return (
    <Panel
      title={L.isDemo ? "Demo source coverage" : "Source coverage"}
      note="records referencing each source"
    >
      {profile.sources.length === 0 ? (
        <p className="text-[9.5px] text-faint">
          No source references in this zone under the active filters.
        </p>
      ) : (
        <div className="space-y-1">
          {profile.sources.slice(0, 6).map((source) => (
            <div key={source.id} className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full bg-info/70"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted">
                {source.name}
              </span>
              <span className="shrink-0 font-mono text-[7px] uppercase tracking-[0.04em] text-faint">
                {SOURCE_TIER_LABELS[
                  source.tier as keyof typeof SOURCE_TIER_LABELS
                ] ?? source.tier}
              </span>
              <span className="w-5 shrink-0 text-right font-mono text-[8.5px] tabular text-ink">
                {source.count}
              </span>
              <span className="w-7 shrink-0 text-right font-mono text-[7.5px] tabular text-faint">
                {formatPercent(source.share)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[8.5px] leading-relaxed text-faint">
        {L.isDemo
          ? "All sources shown are fictional demo sources with no external URLs."
          : "Each source links to the original publisher where a URL was recorded."}
      </p>
    </Panel>
  );
}

function ZoneProfileSection({
  profile,
  liteMode,
  days,
  onDays,
  referenceTime,
}: {
  profile: ZoneProfile;
  liteMode: boolean;
  days: RegionalTrendDays;
  onDays: (days: RegionalTrendDays) => void;
  referenceTime: string;
}) {
  const L = useDatasetLabels();
  const filters = useDashboardStore((state) => state.filters);
  const setFilter = useDashboardStore((state) => state.setFilter);
  const setOpen = useDashboardStore((state) => state.setRegionalOpen);
  const zoneFilterActive = filters.zone === profile.zone;

  const kpis = [
    {
      label: "Reported events",
      value: formatNumber(profile.totals.reportedEvents),
      note: `${formatPercent(profile.totals.zonalShare)} of zoned records`,
    },
    {
      label: "Last 24 hours",
      value: formatNumber(profile.totals.last24h),
      note: "occurrence time",
    },
    {
      label: "High severity",
      value: formatNumber(profile.totals.severity4Plus),
      note: `${formatPercent(profile.comparison.highSeverityShare)} of zone records`,
    },
    {
      label: "Corroborated",
      value: formatNumber(profile.totals.corroborated),
      note: `${formatPercent(profile.comparison.corroboratedShare)} incl. official`,
    },
    {
      label: "State coverage",
      value: `${profile.totals.statesReporting}/${profile.totals.statesTotal}`,
      note: "states with records",
    },
    {
      label: "Source groups",
      value: formatNumber(profile.totals.independentSourceGroups),
      note: `${profile.sources.length} ${L.sources} in view`,
    },
  ];

  return (
    <section
      data-testid={`regional-profile-${profile.zone}`}
      aria-labelledby={`regional-profile-${profile.zone}-heading`}
      className="px-3 py-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: profile.color }}
              aria-hidden
            />
            Zone profile · {profile.shortName}
          </p>
          <h3
            id={`regional-profile-${profile.zone}-heading`}
            className="mt-0.5 text-[16px] font-semibold tracking-[0.01em] text-ink"
          >
            {profile.name}
          </h3>
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted">
            {profile.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {zoneFilterActive ? (
            <span className="inline-flex items-center gap-1 rounded border border-positive/35 bg-positive/10 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.06em] text-positive">
              <Check className="size-2.5" aria-hidden /> Dashboard zone filter
              active
            </span>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFilter("zone", profile.zone);
                setOpen(false);
              }}
            >
              <Filter aria-hidden /> Filter dashboard to {profile.name}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            <X aria-hidden /> Close
          </Button>
        </div>
      </div>

      <div className="mt-2 rounded-md border border-line bg-panel-2/45 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="info">{L.summary}</Badge>
          <span className="font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
            deterministic aggregation · not AI analysis
          </span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
          {profile.assessment}
        </p>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded border border-line bg-canvas-2/55 px-2 py-1.5"
          >
            <p className="truncate font-mono text-[7px] uppercase tracking-[0.08em] text-faint">
              {kpi.label}
            </p>
            <p className="tabular mt-0.5 font-mono text-[15px] leading-none text-ink">
              {kpi.value}
            </p>
            <p className="mt-1 truncate text-[7.5px] text-faint">{kpi.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-2 grid gap-2 xl:grid-cols-[1.35fr_1fr]">
        <TrendPanel
          profile={profile}
          liteMode={liteMode}
          days={days}
          onDays={onDays}
        />
        <NationalComparisonPanel profile={profile} />
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-3">
        <CategoryPanel profile={profile} />
        <SeverityPanel profile={profile} />
        <EvidencePanel profile={profile} />
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.1fr_1fr]">
        <StateCoveragePanel profile={profile} referenceTime={referenceTime} />
        <RecentEventsPanel profile={profile} referenceTime={referenceTime} />
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <SourcesPanel profile={profile} />
        <Panel title="Limits of this comparison">
          <ul className="list-inside list-disc space-y-1 text-[8.5px] leading-relaxed text-warning/85">
            {profile.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <p className="mt-2 flex items-center gap-1.5 rounded border border-warning/25 bg-warning/5 px-2.5 py-1.5 text-[8.5px] leading-relaxed text-warning/85">
        <TriangleAlert className="size-3 shrink-0" aria-hidden />
        This profile describes {L.reportedVolume} only. It is not an operational
        assessment, incident count or safety ranking for {profile.name}.
      </p>
    </section>
  );
}

function SelectPrompt({
  zones,
  onSelect,
}: {
  zones: ZoneComparison[];
  onSelect: (zone: ZoneId) => void;
}) {
  const L = useDatasetLabels();
  return (
    <section className="grid place-items-center px-6 py-10 text-center">
      <div className="max-w-md">
        <Layers className="mx-auto size-5 text-info/80" aria-hidden />
        <h3 className="mt-2 text-[13px] font-semibold text-ink">
          Select a zone profile
        </h3>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Choose one of the six zones above to see its trend, category mix,
          evidence status, state coverage and latest {L.fictionalRecords}. No
          zone is ranked by safety or risk.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {zones.map((zone) => (
            <Button
              key={zone.zone}
              variant="outline"
              size="xs"
              onClick={() => onSelect(zone.zone)}
              aria-label={`Open ${zone.name} zone profile`}
            >
              {zone.shortName} · {formatNumber(zone.reportedEvents)}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RegionalDialog({ referenceTime }: { referenceTime: string }) {
  const L = useDatasetLabels();
  const open = useDashboardStore((state) => state.regionalOpen);
  const setOpen = useDashboardStore((state) => state.setRegionalOpen);
  const filters = useDashboardStore((state) => state.filters);
  const selectedZone = useDashboardStore((state) => state.regionalZone);
  const setRegionalZone = useDashboardStore((state) => state.setRegionalZone);
  const days = useDashboardStore((state) => state.regionalDays);
  const setRegionalDays = useDashboardStore((state) => state.setRegionalDays);
  const liteMode = useDashboardStore((state) => state.liteMode);
  const resetFilters = useDashboardStore((state) => state.resetFilters);

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: [
      "regional",
      filters.window,
      filters.category,
      filters.severity,
      filters.verification,
      filters.q,
      selectedZone ?? "all",
      days,
    ],
    queryFn: ({ signal }) => fetchRegional(filters, selectedZone, days, signal),
    enabled: open,
    staleTime: 30_000,
    retry: 1,
  });

  const activeChips = [
    filters.category !== "all"
      ? categoryConfig(filters.category).shortLabel
      : null,
    filters.severity !== "all" ? `Severity ${filters.severity}` : null,
    filters.verification !== "all"
      ? filters.verification.replaceAll("_", " ")
      : null,
    filters.window !== "all" ? `Last ${filters.window}` : "All time",
    filters.q ? `“${filters.q}”` : null,
    selectedZone ? zoneConfig(selectedZone).name : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-h-[92dvh] max-w-6xl overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="flex max-h-[92dvh] min-h-0 flex-col">
          <div className="shrink-0 border-b border-line bg-panel-2/40 px-4 py-3 pr-12">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Layers className="size-4 text-info" aria-hidden />
              Regional intelligence
            </DialogTitle>
            <DialogDescription className="mt-1 text-[10.5px] leading-relaxed">
              Six geopolitical zone profiles, like-for-like comparisons and
              reported-volume trends under the active filters. A selected state
              is excluded so all six zones stay comparable. Every figure
              describes a {L.snapshot}.
            </DialogDescription>
            <div className="mt-2 flex flex-wrap gap-1">
              {activeChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded border border-line bg-canvas-2 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.05em] text-faint"
                >
                  {chip}
                </span>
              ))}
              <span className="rounded border border-warning/35 bg-warning/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.05em] text-warning">
                Volume · not risk
              </span>
              {isFetching ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.05em] text-faint">
                  <Loader2 className="size-2.5 animate-spin" aria-hidden />{" "}
                  Refreshing
                </span>
              ) : null}
            </div>
          </div>

          {isPending ? (
            <div className="grid min-h-[360px] place-items-center">
              <div className="text-center">
                <Loader2
                  className="mx-auto size-4 animate-spin text-info"
                  aria-hidden
                />
                <p className="mt-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                  Loading regional {L.isDemo ? "demo " : ""}intelligence…
                </p>
              </div>
            </div>
          ) : isError ? (
            <div className="grid min-h-[360px] place-items-center px-6 text-center">
              <div>
                <TriangleAlert
                  className="mx-auto size-5 text-critical"
                  aria-hidden
                />
                <p className="mt-2 text-[12px] text-ink">
                  Regional data is unavailable
                </p>
                <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted">
                  The regional endpoint did not respond. No regional figures can
                  be confirmed, and no estimate is substituted.
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-2 rounded border border-line-2 bg-panel-2 px-2.5 py-1 text-[10px] text-ink hover:bg-panel-3 focus-visible:outline-2 focus-visible:outline-info"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : data && data.totals.reportedEvents === 0 ? (
            <div className="grid min-h-[360px] place-items-center px-6 text-center">
              <div className="max-w-md">
                <CircleSlash
                  className="mx-auto size-5 text-faint"
                  aria-hidden
                />
                <p className="mt-2 text-[12px] text-ink">
                  No {L.records} match these filters
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  The six-zone comparison has no records to describe. Absence of
                  records is not evidence of safety. Clear the filters to
                  restore the full {L.snapshot}.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    resetFilters();
                    setOpen(false);
                  }}
                >
                  Clear filters and close
                </Button>
              </div>
            </div>
          ) : data ? (
            <>
              <ZoneSelector
                zones={data.zones}
                selectedZone={selectedZone}
                onSelect={setRegionalZone}
              />
              <div className="nsm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <ComparisonSection
                  data={data}
                  selectedZone={selectedZone}
                  onSelect={setRegionalZone}
                />
                {data.selected ? (
                  <ZoneProfileSection
                    profile={data.selected}
                    liteMode={liteMode}
                    days={days}
                    onDays={setRegionalDays}
                    referenceTime={referenceTime}
                  />
                ) : (
                  <SelectPrompt zones={data.zones} onSelect={setRegionalZone} />
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-warning/5 px-3 py-2 font-mono text-[7.5px] uppercase tracking-[0.06em] text-warning/80">
                  <TrendingUp className="size-2.5" aria-hidden />
                  <span>
                    {L.isDemo
                      ? "Fictional demo snapshot"
                      : "Published records"}{" "}
                    · reference {referenceTime}
                  </span>
                  <span className="text-line-2">·</span>
                  <span>Reported volume is not incidence, risk or safety</span>
                  <span className="ml-auto inline-flex items-center gap-1">
                    <ShieldCheck className="size-2.5" aria-hidden /> Evidence
                    fields retained
                  </span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
