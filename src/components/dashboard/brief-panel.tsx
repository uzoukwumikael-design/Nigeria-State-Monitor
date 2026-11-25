"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Gauge,
  Layers,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/tooltip";
import { EventCardMini } from "@/components/dashboard/event-card";
import {
  CATEGORIES,
  SEVERITY_CONFIG,
  VERIFICATION_CONFIG,
  categoryConfig,
  zoneConfig,
} from "@/lib/config";
import {
  formatArea,
  formatDateTime,
  formatNumber,
  formatPercent,
  relativeTime,
} from "@/lib/format";
import { getStateStats, type NationalSummary } from "@/lib/intelligence";
import type { Filters, IntelligenceEvent, StateGeo } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
function SectionTitle({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1">
      <h3 className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-faint">
        {children}
      </h3>
      {note ? (
        <InfoTooltip label={note}>
          <span className="grid size-3 place-items-center rounded-full border border-line-2 text-[7.5px] text-faint">
            ?
          </span>
        </InfoTooltip>
      ) : null}
    </div>
  );
}

function CategoryBars({
  events,
  showAll,
  onSelect,
}: {
  events: readonly IntelligenceEvent[];
  showAll?: boolean;
  onSelect?: (category: (typeof CATEGORIES)[number]["id"]) => void;
}) {
  const rows = CATEGORIES.map((category) => {
    const count = events.filter(
      (event) => event.category === category.id,
    ).length;
    return {
      ...category,
      count,
      share: events.length ? count / events.length : 0,
    };
  })
    .filter((row) => showAll || row.count > 0)
    .sort((a, b) => b.count - a.count);

  if (rows.length === 0) {
    return (
      <p className="text-[10px] text-faint">No reported events in this view.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const content = (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="truncate text-[10px] text-muted">
                {row.shortLabel}
              </span>
              <span className="ml-auto font-mono text-[9px] tabular text-ink">
                {row.count}
              </span>
              <span className="w-7 text-right font-mono text-[8px] tabular text-faint">
                {formatPercent(row.share)}
              </span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-canvas-2">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(2, row.share * 100)}%`,
                  backgroundColor: row.color,
                }}
              />
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            aria-label={`Filter by ${row.label}: ${row.count} reported events`}
            className="block w-full rounded-sm px-0.5 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-info"
          >
            {content}
          </button>
        ) : (
          <div key={row.id} className="px-0.5">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function NationalBrief({
  summary,
  scopeEvents,
  referenceTime,
  states,
}: {
  summary: NationalSummary;
  scopeEvents: IntelligenceEvent[];
  referenceTime: string;
  states: readonly StateGeo[];
}) {
  const L = useDatasetLabels();
  const setFilter = useDashboardStore((state) => state.setFilter);
  const selectState = useDashboardStore((state) => state.selectState);
  const setRegionalOpen = useDashboardStore((state) => state.setRegionalOpen);
  const statesWithNoReports = states.filter(
    (state) => !scopeEvents.some((event) => event.stateId === state.id),
  );
  const corroborated = summary.totals.corroborated;
  const unassessed = summary.totals.unassessed;

  return (
    <div className="nsm-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
      <div className="rounded-md border border-line bg-panel-2/60 px-2.5 py-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-faint">
              Automated national summary
            </p>
            <p className="mt-0.5 text-[10px] text-muted">
              {summary.scopeLabel} · current filters
            </p>
          </div>
          <Badge variant="info" className="shrink-0">
            Rule-based
          </Badge>
        </div>
        <p className="mt-2 text-[10.5px] leading-[1.55] text-muted">
          {summary.assessment}
        </p>
        <p className="mt-1.5 border-t border-line/70 pt-1.5 font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
          Deterministic aggregation · not AI analysis · not an operational
          assessment
        </p>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[
          {
            label: "24 hours",
            value: formatNumber(summary.totals.last24h),
            note: "occurrence time",
          },
          {
            label: "High severity",
            value: formatNumber(summary.totals.severity4Plus),
            note: "reported 4–5",
          },
          {
            label: "States",
            value: `${formatNumber(summary.totals.statesWithReports)}/37`,
            note: "with reports",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded border border-line bg-canvas-2/60 px-2 py-1.5"
          >
            <p className="truncate font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
              {item.label}
            </p>
            <p className="tabular mt-0.5 font-mono text-sm text-ink">
              {item.value}
            </p>
            <p className="truncate text-[8px] text-faint">{item.note}</p>
          </div>
        ))}
      </div>

      <section className="mt-3">
        <SectionTitle
          note={`Reported category mix. Percentages use the filtered ${L.event} count as the denominator.`}
        >
          Category mix
        </SectionTitle>
        <CategoryBars
          events={scopeEvents}
          showAll
          onSelect={(category) => setFilter("category", category)}
        />
      </section>

      <section className="mt-3">
        <SectionTitle note="States with the highest reported event volume under the current filters. Volume is not incidence, risk or a safety ranking.">
          Reported volume by state
        </SectionTitle>
        <div className="space-y-1">
          {summary.topStates.length === 0 ? (
            <p className="text-[10px] text-faint">
              No state-level records in view.
            </p>
          ) : (
            summary.topStates.map((state) => (
              <button
                key={state.id}
                type="button"
                onClick={() => selectState(state.id)}
                className="flex w-full items-center gap-2 rounded-sm px-0.5 py-0.5 text-left transition-colors hover:bg-panel-2/60 focus-visible:outline-2 focus-visible:outline-info"
                aria-label={`Open ${state.name} brief: ${state.count} reported events`}
              >
                <span className="w-20 shrink-0 truncate text-[10px] text-muted">
                  {state.name}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-canvas-2">
                  <span
                    className="block h-full rounded-full bg-info/70"
                    style={{ width: `${Math.max(3, state.share * 100)}%` }}
                  />
                </span>
                <span className="w-6 text-right font-mono text-[9px] tabular text-ink">
                  {state.count}
                </span>
                <ArrowUpRight
                  className="size-2.5 shrink-0 text-faint"
                  aria-hidden
                />
              </button>
            ))
          )}
        </div>
      </section>

      <section className="mt-3">
        <SectionTitle note="Six geopolitical zones used for analysis. Zone volume is reported event volume, not risk.">
          Zones
        </SectionTitle>
        <div className="space-y-1">
          {summary.zones.map((zone) => (
            <button
              key={zone.zone}
              type="button"
              onClick={() => setFilter("zone", zone.zone)}
              className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-left transition-colors hover:bg-panel-2/60 focus-visible:outline-2 focus-visible:outline-info"
              aria-label={`Filter by ${zone.name} zone: ${zone.reportedEvents} reported events`}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: zone.color }}
                aria-hidden
              />
              <span className="truncate text-[10px] text-muted">
                {zone.name}
              </span>
              <span className="ml-auto font-mono text-[9px] tabular text-ink">
                {zone.reportedEvents}
              </span>
              <span className="w-8 text-right font-mono text-[8px] tabular text-faint">
                {formatPercent(zone.share)}
              </span>
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="xs"
          className="mt-1.5 w-full"
          onClick={() => setRegionalOpen(true)}
        >
          Compare all six zones
        </Button>
      </section>

      <section className="mt-3">
        <SectionTitle note="Verification is based on independent source groups, not the number of article copies.">
          Evidence status
        </SectionTitle>
        <div className="grid grid-cols-2 gap-1">
          {[
            {
              label: "Corroborated / official",
              value: corroborated,
              color: "#20C997",
            },
            {
              label: "Disputed",
              value: summary.totals.disputed,
              color: "#FFB020",
            },
            {
              label: "Single source",
              value: summary.totals.singleSource,
              color: "#8492A8",
            },
            { label: "Unassessed", value: unassessed, color: "#64748B" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-1.5 rounded border border-line/70 bg-canvas-2/50 px-1.5 py-1"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              <span className="truncate text-[9px] text-muted">
                {item.label}
              </span>
              <span className="ml-auto font-mono text-[9px] tabular text-ink">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-3">
        <SectionTitle
          note={`States with no reported ${L.events} under the current filters. Absence of reports is not evidence of safety or of no activity.`}
        >
          Coverage gaps
        </SectionTitle>
        {statesWithNoReports.length === 0 ? (
          <p className="text-[10px] text-muted">
            All 37 first-order units have at least one reported {L.event} in
            this view.
          </p>
        ) : (
          <p className="text-[10px] leading-relaxed text-muted">
            <span className="font-mono text-ink">
              {statesWithNoReports.length}
            </span>{" "}
            states have no reported {L.event} in view:{" "}
            <span className="text-faint">
              {statesWithNoReports
                .slice(0, 8)
                .map((state) => state.name)
                .join(", ")}
              {statesWithNoReports.length > 8
                ? `, +${statesWithNoReports.length - 8} more`
                : ""}
            </span>
            . No conclusion about safety should be drawn.
          </p>
        )}
      </section>

      <div className="mt-3 rounded border border-line/70 bg-canvas-2/50 px-2 py-1.5">
        <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
          <CalendarClock className="size-2.5" aria-hidden />
          Coverage {summary.totals.reportedEvents > 0 ? "in view" : "none"}
        </p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-faint">
          {L.isDemo ? "Static fictional snapshot. " : ""}Event counts are
          reported volume, not incidence. No historical completeness is claimed.
        </p>
      </div>
      <p className="mt-2 pb-1 text-right font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
        Reference {formatDateTime(referenceTime)}
      </p>
    </div>
  );
}

function StateBrief({
  state,
  events,
  referenceTime,
  filters,
}: {
  state: StateGeo;
  events: IntelligenceEvent[];
  referenceTime: string;
  filters: Filters;
}) {
  const L = useDatasetLabels();
  const selectState = useDashboardStore((state) => state.selectState);
  const setFilter = useDashboardStore((state) => state.setFilter);
  const setMobileView = useDashboardStore((store) => store.setMobileView);
  const selectEvent = useDashboardStore((store) => store.selectEvent);
  const setRegionalOpen = useDashboardStore((store) => store.setRegionalOpen);
  const setRegionalZone = useDashboardStore((store) => store.setRegionalZone);
  const stats = getStateStats(events, state, referenceTime);
  const zone = zoneConfig(state.zone);
  const latest = [...events]
    .filter((event) => event.stateId === state.id)
    .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
    .slice(0, 3);

  return (
    <div className="nsm-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
      <button
        type="button"
        onClick={() => selectState(null)}
        className="mb-2 inline-flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-info"
      >
        <ArrowLeft className="size-3" aria-hidden /> National overview
      </button>

      <div className="flex items-start gap-2">
        <div
          className="mt-1 grid size-8 shrink-0 place-items-center rounded-md border"
          style={{
            borderColor: `${zone.color}55`,
            backgroundColor: `${zone.color}14`,
          }}
        >
          <MapPin
            className="size-4"
            style={{ color: zone.color }}
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-tight text-ink">
            {state.name}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
            <span style={{ color: zone.color }}>{zone.name}</span>
            <span className="text-line-2">/</span>
            <span>Capital {state.capital}</span>
            <span className="text-line-2">/</span>
            <span>{state.id}</span>
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <div className="rounded border border-line bg-canvas-2/60 px-2 py-1.5">
          <p className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
            Reported events
          </p>
          <p className="tabular mt-0.5 font-mono text-lg leading-none text-ink">
            {stats.reportedEvents}
          </p>
          <p className="mt-0.5 text-[8px] text-faint">under current filters</p>
        </div>
        <div className="rounded border border-line bg-canvas-2/60 px-2 py-1.5">
          <p className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
            Last 24 hours
          </p>
          <p className="tabular mt-0.5 font-mono text-lg leading-none text-ink">
            {stats.last24h}
          </p>
          <p className="mt-0.5 text-[8px] text-faint">by occurrence time</p>
        </div>
        <div className="rounded border border-line bg-canvas-2/60 px-2 py-1.5">
          <p className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
            High severity
          </p>
          <p className="tabular mt-0.5 font-mono text-lg leading-none text-ink">
            {
              events.filter(
                (event) => event.stateId === state.id && event.severity >= 4,
              ).length
            }
          </p>
          <p className="mt-0.5 text-[8px] text-faint">
            {stats.critical} critical
          </p>
        </div>
        <div className="rounded border border-line bg-canvas-2/60 px-2 py-1.5">
          <p className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
            Corroborated
          </p>
          <p className="tabular mt-0.5 font-mono text-lg leading-none text-ink">
            {stats.corroborated}
          </p>
          <p className="mt-0.5 text-[8px] text-faint">
            {stats.disputed} disputed
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 rounded border border-line/70 bg-canvas-2/40 px-2 py-1.5">
        <Gauge className="size-3 shrink-0 text-faint" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-[9px] text-muted">
            Top category:{" "}
            <span className="text-ink">
              {stats.topCategory
                ? categoryConfig(stats.topCategory).shortLabel
                : "none in view"}
            </span>
          </p>
          <p className="truncate font-mono text-[8px] text-faint">
            Latest update:{" "}
            {stats.latestReportedAt
              ? relativeTime(stats.latestReportedAt, referenceTime)
              : "none"}
          </p>
        </div>
        <span className="ml-auto shrink-0 font-mono text-[8px] tabular text-faint">
          {formatArea(state.areaKm2)}
        </span>
      </div>

      <section className="mt-3">
        <SectionTitle note="Reported category mix inside this state and the current category/time filters. Not a risk profile.">
          Category mix
        </SectionTitle>
        <CategoryBars
          events={events.filter((event) => event.stateId === state.id)}
          showAll
          onSelect={(category) => setFilter("category", category)}
        />
      </section>

      <section className="mt-3">
        <SectionTitle note="Severity is a reported-impact field. It is not a measured risk or safety score.">
          Severity mix
        </SectionTitle>
        <div className="space-y-1">
          {([5, 4, 3, 2, 1] as const).map((severity) => {
            const count = events.filter(
              (event) =>
                event.stateId === state.id && event.severity === severity,
            ).length;
            const total = Math.max(1, stats.reportedEvents);
            const share = count / total;
            const config = SEVERITY_CONFIG[severity];
            return (
              <div key={severity} className="flex items-center gap-1.5">
                <span
                  className="w-14 shrink-0 font-mono text-[8px] uppercase tracking-wide"
                  style={{ color: config.color }}
                >
                  {config.shortLabel}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-canvas-2">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${share * 100}%`,
                      backgroundColor: config.color,
                    }}
                  />
                </span>
                <span className="w-5 text-right font-mono text-[8px] tabular text-faint">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-3">
        <SectionTitle
          note={`Independent source groups represented in this state's ${L.records}.`}
        >
          Verification mix
        </SectionTitle>
        <div className="grid grid-cols-2 gap-1">
          {(
            Object.keys(VERIFICATION_CONFIG) as Array<
              keyof typeof VERIFICATION_CONFIG
            >
          )
            .filter((status) => stats.verification[status] > 0)
            .map((status) => (
              <span
                key={status}
                className="flex items-center gap-1 truncate rounded border border-line/70 bg-canvas-2/50 px-1.5 py-1 text-[8.5px] text-muted"
              >
                <ShieldCheck
                  className="size-2.5 shrink-0"
                  style={{ color: VERIFICATION_CONFIG[status].color }}
                  aria-hidden
                />
                <span className="truncate">
                  {VERIFICATION_CONFIG[status].shortLabel}
                </span>
                <span className="ml-auto font-mono text-[8px] tabular text-ink">
                  {stats.verification[status]}
                </span>
              </span>
            ))}
        </div>
      </section>

      <section className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-faint">
            Latest reports
          </h3>
          <button
            type="button"
            onClick={() => {
              setMobileView("wire");
              document
                .getElementById("wire-panel")
                ?.scrollIntoView({ block: "start" });
            }}
            className="font-mono text-[8px] uppercase tracking-[0.06em] text-info hover:underline"
          >
            Open wire
          </button>
        </div>
        {latest.length === 0 ? (
          <p className="text-[10px] text-faint">
            No reported events in this view.
          </p>
        ) : (
          <div className="rounded border border-line/70 bg-canvas-2/30">
            {latest.map((event) => (
              <EventCardMini
                key={event.id}
                event={event}
                referenceTime={referenceTime}
                onOpen={selectEvent}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-3 rounded border border-line/70 bg-canvas-2/40 px-2 py-1.5">
        <p className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
          <Building2 className="size-2.5" aria-hidden /> Profile
        </p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-faint">
          {state.name} is in the {zone.name} geopolitical zone. Capital LGA:{" "}
          {state.capitalLga}. Boundaries are administrative reference geometry,
          not a political claim.
        </p>
      </div>

      <Button
        variant="outline"
        size="xs"
        className="mt-1.5 w-full"
        onClick={() => {
          setRegionalZone(state.zone);
          setRegionalOpen(true);
        }}
      >
        <Layers className="size-2.5" aria-hidden /> Open {zone.name} zone
        profile
      </Button>

      <p className="mt-2 pb-1 font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
        Filters:{" "}
        {filters.category === "all"
          ? "all categories"
          : categoryConfig(filters.category).shortLabel}{" "}
        · {filters.window === "all" ? "all time" : `last ${filters.window}`} ·{" "}
        {filters.q ? `“${filters.q}”` : "no query"}
      </p>
    </div>
  );
}

export function BriefPanel({
  summary,
  state,
  scopeEvents,
  referenceTime,
  states,
  filters,
}: {
  summary: NationalSummary;
  state: StateGeo | null;
  scopeEvents: IntelligenceEvent[];
  referenceTime: string;
  states: readonly StateGeo[];
  filters: Filters;
}) {
  const L = useDatasetLabels();
  return (
    <aside
      aria-label={state ? `${state.name} state brief` : "National brief"}
      className={cn(
        "flex h-full min-h-0 flex-col bg-panel/25 lg:border-l lg:border-line",
        state ? "" : "",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          {state ? "State brief" : "National brief"}
        </h2>
        {state ? (
          <span className="rounded border border-info/30 bg-info/10 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-info">
            {state.id}
          </span>
        ) : (
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-faint">
            36 states + FCT
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.06em] text-faint">
          {L.isDemo ? (
            <>
              <span className="size-1 rounded-full bg-warning" aria-hidden />
              Demo
            </>
          ) : null}
        </span>
      </div>

      {state ? (
        <StateBrief
          state={state}
          events={scopeEvents}
          referenceTime={referenceTime}
          filters={filters}
        />
      ) : (
        <NationalBrief
          summary={summary}
          scopeEvents={scopeEvents}
          referenceTime={referenceTime}
          states={states}
        />
      )}
    </aside>
  );
}
