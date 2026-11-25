"use client";

import {
  BadgeCheck,
  Clock3,
  Map,
  Radio,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { NationalSummary } from "@/lib/intelligence";
import { InfoTooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
function Delta({ value, baseline }: { value: number; baseline: number }) {
  if (baseline === 0) {
    return <span className="text-faint">no prior-period baseline</span>;
  }
  if (value === 0) return <span className="text-faint">no change</span>;
  const positive = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5",
        positive ? "text-warning" : "text-positive",
      )}
    >
      {positive ? (
        <TrendingUp className="size-2.5" aria-hidden />
      ) : (
        <TrendingDown className="size-2.5" aria-hidden />
      )}
      {positive ? "+" : ""}
      {formatNumber(value)} vs previous period
    </span>
  );
}

export function KpiStrip({
  summary,
  previousReported,
  scopeLabel,
  windowLabel,
}: {
  summary: NationalSummary;
  previousReported: number;
  scopeLabel: string;
  windowLabel: string;
}) {
  const L = useDatasetLabels();
  const delta = summary.totals.reportedEvents - previousReported;

  const cards = [
    {
      key: "reported",
      label: "Reported events",
      value: formatNumber(summary.totals.reportedEvents),
      icon: Radio,
      sub:
        windowLabel === "All time" ? (
          <span className="text-faint">entire {L.snapshotShort}</span>
        ) : (
          <Delta value={delta} baseline={previousReported} />
        ),
      tooltip: `Count of event-level ${L.records} matching the active filters. This is reported volume, not incidence, risk or a safety ranking.`,
    },
    {
      key: "last24h",
      label: "Last 24 hours",
      value: formatNumber(summary.totals.last24h),
      icon: Clock3,
      sub: <span className="text-faint">by occurrence time</span>,
      tooltip: `Events whose occurrence time falls within 24 hours of the ${L.referenceTime}. Occurrence time can differ from report time.`,
    },
    {
      key: "states",
      label: "States with reports",
      value: `${formatNumber(summary.totals.statesWithReports)} / 37`,
      icon: Map,
      sub: (
        <span className="text-faint">
          {formatNumber(summary.totals.nationalEvents)} national, no state point
        </span>
      ),
      tooltip: `State-level coverage of the current filtered ${L.records}. National records without a state location are excluded from this count.`,
    },
    {
      key: "verified",
      label: "Corroborated / official",
      value: formatNumber(summary.totals.corroborated),
      icon: BadgeCheck,
      sub: (
        <span className="text-faint">
          {formatNumber(summary.totals.singleSource)} single-source ·{" "}
          {formatNumber(summary.totals.disputed)} disputed
        </span>
      ),
      tooltip: `${L.Events} with corroborated or official-confirmation status. Independent source groups are counted separately from article copies.`,
    },
    {
      key: "high",
      label: "High severity",
      value: formatNumber(summary.totals.severity4Plus),
      icon: TriangleAlert,
      sub: (
        <span className="text-faint">
          severity 4–5 · {formatNumber(summary.totals.critical)} critical
        </span>
      ),
      tooltip: `Reported severity 4–5 in the ${L.dataset}. Severity is a reported-impact field, not a measured risk score.`,
    },
  ];

  return (
    <section
      aria-label={`Key indicators for ${scopeLabel}`}
      className="shrink-0 border-b border-line bg-canvas px-2 py-2 sm:px-3"
    >
      <div className="nsm-scroll -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.key}
              className="hairline-top min-w-[148px] flex-1 rounded-md border border-line/80 bg-panel/70 px-2.5 py-2 sm:min-w-0"
            >
              <div className="flex items-center gap-1.5">
                <Icon className="size-3 text-faint" aria-hidden />
                <p className="truncate font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">
                  {card.label}
                </p>
                <InfoTooltip label={card.tooltip}>
                  <span className="ml-auto grid size-3 place-items-center rounded-full border border-line-2 text-[8px] text-faint">
                    ?
                  </span>
                </InfoTooltip>
              </div>
              <p className="tabular mt-1 font-mono text-[20px] font-medium leading-none tracking-tight text-ink">
                {card.value}
              </p>
              <p className="mt-1.5 truncate text-[9.5px] leading-none text-muted">
                {card.sub}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
