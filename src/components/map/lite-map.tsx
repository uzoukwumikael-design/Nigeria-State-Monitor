"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { categoryConfig } from "@/lib/config";
import { volumeColor } from "@/lib/geo/volume";
import { projectLngLat, type SvgMapData } from "@/lib/geo/projection";
import type { StateStats } from "@/lib/intelligence";
import type { IntelligenceEvent, StateGeo } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
interface LiteMapProps {
  states: readonly StateGeo[];
  stats: Record<string, StateStats>;
  events: IntelligenceEvent[];
  selectedStateId: string | null;
  selectedEventId: string | null;
  onSelectState: (stateId: string | null) => void;
  onSelectEvent: (eventId: string) => void;
  onHoverState: (
    stateId: string | null,
    point: { x: number; y: number } | null,
  ) => void;
  onHoverEvent: (
    eventId: string | null,
    point: { x: number; y: number } | null,
  ) => void;
}

async function fetchSvgMap(): Promise<SvgMapData> {
  const response = await fetch("/data/nigeria-svg-map.json", {
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`SVG map request failed (${response.status})`);
  return (await response.json()) as SvgMapData;
}

export function LiteMap({
  states,
  stats,
  events,
  selectedStateId,
  selectedEventId,
  onSelectState,
  onSelectEvent,
  onHoverState,
  onHoverEvent,
}: LiteMapProps) {
  const L = useDatasetLabels();
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, isError, isPending, refetch } = useQuery({
    queryKey: ["svg-map"],
    queryFn: fetchSvgMap,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const plottedEvents = useMemo(
    () => events.filter((event) => event.coordinates !== null),
    [events],
  );

  const pointFor = (x: number, y: number): { x: number; y: number } => {
    const container = containerRef.current;
    if (!container || !data) return { x, y };
    const rect = container.getBoundingClientRect();
    // The SVG uses preserveAspectRatio="xMidYMid meet"; derive the fitted box.
    const scale = Math.min(rect.width / data.width, rect.height / data.height);
    const offsetX = (rect.width - data.width * scale) / 2;
    const offsetY = (rect.height - data.height * scale) / 2;
    return { x: offsetX + x * scale, y: offsetY + y * scale };
  };

  if (isPending) {
    return (
      <div className="grid h-full place-items-center" aria-busy="true">
        <div className="text-center">
          <div className="mx-auto mb-2 h-1 w-28 overflow-hidden rounded-full bg-panel-3">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-info/60" />
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
            Loading lite map…
          </p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <div>
          <p className="text-[12px] text-ink">
            The lite map data could not be loaded.
          </p>
          <p className="mt-1 text-[10px] text-muted">
            No external tiles are involved; the local GeoJSON asset failed.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded border border-line-2 bg-panel-2 px-2.5 py-1 text-[10px] text-ink hover:bg-panel-3"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg
        viewBox={data.viewBox}
        className="h-full w-full"
        role="group"
        aria-label="Interactive map of Nigeria's 36 states and the Federal Capital Territory. Use Tab to move between states and Enter to select."
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="lite-grid-glow" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#0d1a2b" />
            <stop offset="100%" stopColor="#060b14" />
          </radialGradient>
        </defs>
        <rect
          width={data.width}
          height={data.height}
          fill="url(#lite-grid-glow)"
          aria-hidden
        />
        <g>
          {data.states.map((svgState) => {
            const state = stateById.get(svgState.id);
            const stateStat = stats[svgState.id];
            const count = stateStat?.reportedEvents ?? 0;
            const selected = selectedStateId === svgState.id;
            const topCategory = stateStat?.topCategory;
            const [labelX, labelY] = svgState.label;
            const label = `${state?.name ?? svgState.name}. ${count} reported ${count === 1 ? L.event : L.events}. ${topCategory ? `Top category ${categoryConfig(topCategory).shortLabel}.` : "No reported events in view."}${selected ? " Selected." : ""}`;
            return (
              <path
                key={svgState.id}
                d={svgState.path}
                data-testid={`state-path-${svgState.id}`}
                data-state-id={svgState.id}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onSelectState(selected ? null : svgState.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectState(selected ? null : svgState.id);
                  }
                  if (event.key === "Escape") onSelectState(null);
                }}
                onMouseEnter={() => {
                  if (!state) return;
                  onHoverState(svgState.id, pointFor(labelX, labelY));
                }}
                onMouseLeave={() => onHoverState(null, null)}
                onFocus={() => {
                  if (!state) return;
                  onHoverState(svgState.id, pointFor(labelX, labelY));
                }}
                onBlur={() => onHoverState(null, null)}
                fill={selected ? "#0d3c46" : volumeColor(count)}
                stroke={
                  selected ? "#5eead4" : count > 0 ? "#24506b" : "#1a2a3e"
                }
                strokeWidth={selected ? 2.4 : 0.9}
                className={cn(
                  "cursor-pointer outline-none transition-[fill] duration-150 hover:brightness-125 focus-visible:brightness-125",
                  selected && "drop-shadow-[0_0_6px_rgba(94,234,212,0.35)]",
                )}
              />
            );
          })}
        </g>
        <g aria-hidden>
          {data.states.map((svgState) => {
            const stat = stats[svgState.id];
            const count = stat?.reportedEvents ?? 0;
            const [labelX, labelY, labelArea] = svgState.label;
            const showLabel =
              (labelArea >= 4_000 ||
                svgState.id === "NG-LA" ||
                svgState.id === "NG-FC") &&
              count > 0;
            if (!showLabel) return null;
            const selected = selectedStateId === svgState.id;
            return (
              <text
                key={`label-${svgState.id}`}
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fontSize={labelArea >= 14_000 ? 15 : 12.5}
                fontWeight={600}
                fill={selected ? "#7ff5e4" : "#b7c6da"}
                stroke="#060b14"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: "none", letterSpacing: "0.01em" }}
              >
                {svgState.name}
              </text>
            );
          })}
        </g>
        <g>
          {plottedEvents.map((event) => {
            const coordinates = event.coordinates;
            if (!coordinates) return null;
            const projected = projectLngLat(
              coordinates.lng,
              coordinates.lat,
              data.projection,
            );
            const x = projected.x;
            const y = projected.y;
            const color = categoryConfig(event.category).color;
            const selected = selectedEventId === event.id;
            const radius = 3.2 + event.severity * 0.55;
            return (
              <circle
                key={event.id}
                cx={x}
                cy={y}
                r={selected ? radius + 2.2 : radius}
                fill={color}
                stroke={selected ? "#f8fafc" : "#05070f"}
                strokeWidth={selected ? 1.6 : 1}
                opacity={0.92}
                className="cursor-pointer transition-[r] hover:brightness-125"
                onClick={(mouseEvent) => {
                  mouseEvent.stopPropagation();
                  onSelectEvent(event.id);
                }}
                onMouseEnter={(mouseEvent) => {
                  const container =
                    containerRef.current?.getBoundingClientRect();
                  const circle =
                    mouseEvent.currentTarget.getBoundingClientRect();
                  if (!container) return;
                  onHoverEvent(event.id, {
                    x: circle.left - container.left + circle.width / 2,
                    y: circle.top - container.top,
                  });
                }}
                onMouseLeave={() => onHoverEvent(null, null)}
              >
                <title>{`${event.title} — ${L.event}, click to open`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
