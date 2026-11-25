"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  Layers,
  List,
  Map as MapIcon,
  MousePointerClick,
  RotateCcw,
  X,
} from "lucide-react";
import { ALL_CATEGORIES } from "@/components/dashboard/category-icon";
import { Button } from "@/components/ui/button";
import { LiteMap } from "@/components/map/lite-map";
import { categoryConfig } from "@/lib/config";
import { formatCoordinates, relativeTime } from "@/lib/format";
import { STATE_BY_ID } from "@/lib/geo/states";
import { VOLUME_RAMP } from "@/lib/geo/volume";
import type { StateStats } from "@/lib/intelligence";
import type { IntelligenceEvent, StateGeo } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
const MapLibreCanvas = dynamic(
  () =>
    import("@/components/map/maplibre-map").then(
      (module) => module.MapLibreCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
          Loading standard map…
        </p>
      </div>
    ),
  },
);

interface HoverPoint {
  x: number;
  y: number;
}

export function MapPanel({
  states,
  stats,
  events,
  referenceTime,
}: {
  states: readonly StateGeo[];
  stats: Record<string, StateStats>;
  events: IntelligenceEvent[];
  referenceTime: string;
}) {
  const L = useDatasetLabels();
  const liteMode = useDashboardStore((state) => state.liteMode);
  const liteResolved = useDashboardStore((state) => state.liteResolved);
  const setLiteMode = useDashboardStore((state) => state.setLiteMode);
  const selectedStateId = useDashboardStore((state) => state.filters.stateId);
  const selectedEventId = useDashboardStore((state) => state.selectedEventId);
  const selectState = useDashboardStore((state) => state.toggleState);
  const clearState = useDashboardStore((state) => state.selectState);
  const selectEvent = useDashboardStore((state) => state.selectEvent);
  const setDirectoryOpen = useDashboardStore((state) => state.setDirectoryOpen);
  const [hoverState, setHoverState] = useState<{
    stateId: string;
    point: HoverPoint;
  } | null>(null);
  const [hoverEvent, setHoverEvent] = useState<{
    eventId: string;
    point: HoverPoint;
  } | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [mapKey, setMapKey] = useState(0);

  const selectedState = STATE_BY_ID.get(selectedStateId ?? "") ?? null;
  const hoveredState = hoverState
    ? (STATE_BY_ID.get(hoverState.stateId) ?? null)
    : null;
  const hoveredEvent = hoverEvent
    ? (events.find((event) => event.id === hoverEvent.eventId) ?? null)
    : null;
  const stateTooltipStat = hoverState ? stats[hoverState.stateId] : null;

  const eventById = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );

  const handleHoverState = (
    stateId: string | null,
    point: HoverPoint | null,
  ) => {
    if (!stateId || !point) {
      setHoverState(null);
      return;
    }
    setHoverEvent(null);
    setHoverState({ stateId, point });
  };

  const handleHoverEvent = (
    eventId: string | null,
    point: HoverPoint | null,
  ) => {
    if (!eventId || !point) {
      setHoverEvent(null);
      return;
    }
    const exists = eventById.has(eventId);
    if (!exists) return;
    setHoverState(null);
    setHoverEvent({ eventId, point });
  };

  const handleSelectState = (stateId: string | null) => {
    if (stateId === null) clearState(null);
    else selectState(stateId);
  };

  const tooltip =
    hoveredEvent && hoverEvent ? (
      <div
        className="pointer-events-none absolute z-20 w-[240px] overflow-hidden rounded-md border border-line-2 bg-[#0b1220] shadow-2xl"
        style={{
          left: `min(${hoverEvent.point.x + 14}px, calc(100% - 252px))`,
          top: `min(${hoverEvent.point.y + 14}px, calc(100% - 160px))`,
        }}
      >
        <div className="border-b border-line/80 px-2.5 py-1.5">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
            {categoryConfig(hoveredEvent.category).shortLabel} · severity{" "}
            {hoveredEvent.severity} · {L.event}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-ink">
            {hoveredEvent.title}
          </p>
        </div>
        <div className="space-y-1 px-2.5 py-1.5 text-[9px]">
          <p className="flex justify-between gap-2 text-faint">
            <span>Location</span>
            <span className="truncate text-right text-muted">
              {hoveredEvent.stateName ?? "National"} ·{" "}
              {hoveredEvent.lga ?? "no LGA"} ·{" "}
              {hoveredEvent.geoPrecision.toUpperCase()}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-faint">
            <span>Updated</span>
            <span className="text-muted">
              {relativeTime(hoveredEvent.lastUpdatedAt, referenceTime)}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-faint">
            <span>Point</span>
            <span className="font-mono text-[8px] text-muted">
              {formatCoordinates(hoveredEvent.coordinates)}
            </span>
          </p>
        </div>
        <p className="border-t border-line/80 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.08em] text-info">
          Click to open the event record
        </p>
      </div>
    ) : hoveredState && hoverState ? (
      <div
        className="pointer-events-none absolute z-20 w-[236px] overflow-hidden rounded-md border border-line-2 bg-[#0b1220] shadow-2xl"
        style={{
          left: `min(${hoverState.point.x + 14}px, calc(100% - 248px))`,
          top: `min(${hoverState.point.y + 14}px, calc(100% - 178px))`,
        }}
      >
        <div className="border-b border-line/80 px-2.5 py-1.5">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
            State · {hoveredState.id} · {hoveredState.zoneName}
          </p>
          <p className="mt-0.5 text-[13px] font-semibold leading-tight text-ink">
            {hoveredState.name}
          </p>
        </div>
        <div className="space-y-1 px-2.5 py-1.5 text-[9px]">
          <p className="flex justify-between gap-2 text-faint">
            <span>Reported events</span>
            <span className="font-mono text-[10px] tabular text-ink">
              {stateTooltipStat?.reportedEvents ?? 0}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-faint">
            <span>Top category</span>
            <span className="text-muted">
              {stateTooltipStat?.topCategory
                ? categoryConfig(stateTooltipStat.topCategory).shortLabel
                : "None"}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-faint">
            <span>Latest update</span>
            <span className="text-muted">
              {stateTooltipStat?.latestReportedAt
                ? relativeTime(stateTooltipStat.latestReportedAt, referenceTime)
                : "No report"}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-faint">
            <span>Capital</span>
            <span className="truncate text-muted">{hoveredState.capital}</span>
          </p>
        </div>
        <p className="border-t border-line/80 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.08em] text-info">
          Click to filter by this state
        </p>
      </div>
    ) : null;

  return (
    <section
      aria-label="Nigeria event map"
      className="flex min-h-0 flex-1 flex-col bg-canvas-2"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <MapIcon className="size-3.5 text-info" aria-hidden />
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          Nigeria · reported events
        </h2>
        {selectedState ? (
          <button
            type="button"
            onClick={() => clearState(null)}
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-info/35 bg-info/10 px-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-info transition-colors hover:bg-info/15 focus-visible:outline-2 focus-visible:outline-info"
            aria-label={`Clear ${selectedState.name} state filter`}
          >
            {selectedState.name}
            <X className="size-2.5" aria-hidden />
          </button>
        ) : (
          <span className="hidden truncate font-mono text-[8px] uppercase tracking-[0.08em] text-faint sm:inline">
            36 states + FCT · reported volume, not risk
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <div
            className="hidden h-6 items-center rounded border border-line bg-canvas p-0.5 sm:inline-flex"
            role="group"
            aria-label="Map renderer"
          >
            <button
              type="button"
              onClick={() => setLiteMode(false, "manual")}
              aria-pressed={!liteMode}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 font-mono text-[8px] uppercase tracking-[0.06em] transition-colors",
                !liteMode
                  ? "bg-panel-3 text-info"
                  : "text-faint hover:text-muted",
              )}
              title="Standard MapLibre map with local geometry"
            >
              <Layers className="size-2.5" aria-hidden /> Standard
            </button>
            <button
              type="button"
              onClick={() => setLiteMode(true, "manual")}
              aria-pressed={liteMode}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 font-mono text-[8px] uppercase tracking-[0.06em] transition-colors",
                liteMode
                  ? "bg-panel-3 text-positive"
                  : "text-faint hover:text-muted",
              )}
              title="Low-bandwidth inline SVG map"
            >
              <MousePointerClick className="size-2.5" aria-hidden /> Lite
            </button>
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => setResetSignal((value) => value + 1)}
            aria-label="Reset map view to Nigeria"
            title="Reset map view"
            className="hidden sm:inline-flex"
          >
            <RotateCcw aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setDirectoryOpen(true)}
            className="h-6 gap-1 px-1.5"
          >
            <List className="size-2.5" aria-hidden />
            <span className="hidden sm:inline">States</span>
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!liteResolved ? (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <div className="mx-auto mb-2 h-1 w-28 overflow-hidden rounded-full bg-panel-3">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-info/60" />
              </div>
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
                Selecting map mode…
              </p>
            </div>
          </div>
        ) : liteMode ? (
          <LiteMap
            states={states}
            stats={stats}
            events={events}
            selectedStateId={selectedStateId}
            selectedEventId={selectedEventId}
            onSelectState={handleSelectState}
            onSelectEvent={selectEvent}
            onHoverState={handleHoverState}
            onHoverEvent={handleHoverEvent}
          />
        ) : (
          <MapLibreCanvas
            key={mapKey}
            states={states}
            stats={stats}
            events={events}
            selectedStateId={selectedStateId}
            selectedEventId={selectedEventId}
            resetSignal={resetSignal}
            onSelectState={handleSelectState}
            onSelectEvent={selectEvent}
            onHoverState={handleHoverState}
            onHoverEvent={handleHoverEvent}
            onUseLite={() => setLiteMode(true, "manual")}
            onRetry={() => {
              setMapKey((value) => value + 1);
              setResetSignal((value) => value + 1);
            }}
          />
        )}

        {tooltip}

        <div className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[280px] rounded border border-line/80 bg-canvas/85 px-2 py-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
              Reported volume
            </span>
            <span className="flex items-center gap-0.5">
              {VOLUME_RAMP.map((step) => (
                <span
                  key={step.color}
                  className="inline-block size-2.5 rounded-[2px] border border-white/5"
                  style={{ backgroundColor: step.color }}
                  title={`${step.label} reported events`}
                  aria-hidden
                />
              ))}
            </span>
            <span className="font-mono text-[7px] text-faint">0 → 7+</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              {ALL_CATEGORIES.map((category) => (
                <span
                  key={category.id}
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: category.color }}
                  title={category.shortLabel}
                  aria-hidden
                />
              ))}
            </span>
            <span className="font-mono text-[7px] uppercase tracking-[0.04em] text-faint">
              dot = category · size = severity
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[6.5px] uppercase tracking-[0.04em] text-faint/80">
            markers are LGA/state representative points, not exact incident
            locations
          </p>
        </div>

        <p className="pointer-events-none absolute bottom-1 right-1 z-10 rounded bg-canvas/70 px-1 py-0.5 font-mono text-[7px] tracking-[0.02em] text-faint/80">
          Boundaries: GRID3 (2022) via geoBoundaries · CC BY 4.0
        </p>
      </div>
    </section>
  );
}
