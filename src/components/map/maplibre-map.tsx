"use client";

import { useQuery } from "@tanstack/react-query";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { useEffect, useRef, useState } from "react";
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { MapMouseEvent } from "maplibre-gl";
import { categoryConfig } from "@/lib/config";
import { NIGERIA_FIT_BOUNDS } from "@/lib/geo/volume";
import type { StateStats } from "@/lib/intelligence";
import type { Category, IntelligenceEvent, StateGeo } from "@/lib/types";

import { useDatasetLabels } from "@/lib/dataset-labels";
interface StateFeatureProperties {
  id: string;
  name: string;
  zone: string;
  capital: string;
  areaKm2: number;
}

interface StatesGeoJson {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: StateFeatureProperties;
    geometry: GeoJSON.Geometry;
  }>;
}

interface EventPointProperties {
  eventId: string;
  category: Category;
  severity: number;
  title: string;
}

interface ClusterProperties {
  totalSeverity: number;
}

const STATES_SOURCE = "nsm-states";
const STATE_FILL_LAYER = "nsm-state-fill";
const STATE_LINE_LAYER = "nsm-state-line";

// MapLibre v6 resolves its worker relative to the bundled module. Next.js emits
// a hashed client chunk, so the default URL fails in production. The worker is
// copied to public/ by scripts/copy-maplibre-worker.mjs and served locally.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STATE_FILL_EXPRESSION: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  "#0d3c46",
  ["boolean", ["feature-state", "hovered"], false],
  "#15546a",
  [
    "interpolate",
    ["linear"],
    ["coalesce", ["feature-state", "count"], 0],
    0,
    "#0b1524",
    1,
    "#10304a",
    3,
    "#144a68",
    5,
    "#1a6688",
    7,
    "#2187aa",
    9,
    "#2fb4dd",
  ],
];

const STATE_LINE_EXPRESSION: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  "#5eead4",
  ["boolean", ["feature-state", "hovered"], false],
  "#7dd3fc",
  [">", ["coalesce", ["feature-state", "count"], 0], 0],
  "#2a5a78",
  "#1b2b3f",
];

const STATE_LINE_WIDTH_EXPRESSION: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  2.1,
  ["boolean", ["feature-state", "hovered"], false],
  1.5,
  0.65,
];

async function fetchStates(): Promise<StatesGeoJson> {
  const response = await fetch("/data/nigeria-states.geojson", {
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`State boundary request failed (${response.status})`);
  return (await response.json()) as StatesGeoJson;
}

export interface MapCanvasProps {
  states: readonly StateGeo[];
  stats: Record<string, StateStats>;
  events: IntelligenceEvent[];
  selectedStateId: string | null;
  selectedEventId: string | null;
  resetSignal: number;
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
  onUseLite: () => void;
  onRetry: () => void;
}

export function MapLibreCanvas({
  states,
  stats,
  events,
  selectedStateId,
  selectedEventId,
  resetSignal,
  onSelectState,
  onSelectEvent,
  onHoverState,
  onHoverEvent,
  onUseLite,
  onRetry,
}: MapCanvasProps) {
  const L = useDatasetLabels();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const clusterRef = useRef<Supercluster<
    EventPointProperties,
    ClusterProperties
  > | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const selectedStateRef = useRef<string | null>(selectedStateId);
  const selectedEventRef = useRef<string | null>(selectedEventId);
  const statsRef = useRef(stats);
  const statesRef = useRef(states);
  const eventsRef = useRef(events);
  const renderMarkersRef = useRef<() => void>(() => {});
  const scheduleRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [layersReady, setLayersReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const callbacksRef = useRef({
    onSelectState,
    onSelectEvent,
    onHoverState,
    onHoverEvent,
  });
  callbacksRef.current = {
    onSelectState,
    onSelectEvent,
    onHoverState,
    onHoverEvent,
  };
  selectedStateRef.current = selectedStateId;
  selectedEventRef.current = selectedEventId;
  statsRef.current = stats;
  statesRef.current = states;
  eventsRef.current = events;

  const {
    data: geojson,
    isError: geoError,
    isPending: geoPending,
    refetch,
  } = useQuery({
    queryKey: ["nigeria-states-geojson"],
    queryFn: fetchStates,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 2,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap;
    try {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "nsm-background",
            type: "background",
            paint: { "background-color": "#060b14" },
          },
        ],
      };
      map = new maplibregl.Map({
        container,
        style,
        center: [8.4, 9.1],
        zoom: 5.1,
        minZoom: 4.2,
        maxZoom: 9.5,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        fadeDuration: 0,
      });
    } catch (error) {
      console.error("maplibre_init_failed", error);
      setMapError(
        error instanceof Error
          ? error.message
          : "The standard map could not be initialised in this browser.",
      );
      return;
    }

    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    const canvas = map.getCanvas();
    const handleMouseMove = (event: MapMouseEvent) => {
      if (!map.getLayer(STATE_FILL_LAYER)) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: [STATE_FILL_LAYER],
      });
      const feature = features[0];
      const id =
        typeof feature?.properties?.id === "string"
          ? feature.properties.id
          : null;
      if (hoveredIdRef.current !== id) {
        if (hoveredIdRef.current) {
          try {
            map.setFeatureState(
              { source: STATES_SOURCE, id: hoveredIdRef.current },
              { hovered: false },
            );
          } catch {
            /* source may not be ready */
          }
        }
        hoveredIdRef.current = id;
        if (id) {
          try {
            map.setFeatureState(
              { source: STATES_SOURCE, id },
              { hovered: true },
            );
          } catch {
            /* source may not be ready */
          }
        }
      }
      canvas.style.cursor = id ? "pointer" : "grab";
      if (id) {
        callbacksRef.current.onHoverState(id, {
          x: event.point.x,
          y: event.point.y,
        });
      } else {
        callbacksRef.current.onHoverState(null, null);
      }
    };

    const handleClick = (event: MapMouseEvent) => {
      if (!map.getLayer(STATE_FILL_LAYER)) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: [STATE_FILL_LAYER],
      });
      const feature = features[0];
      const id =
        typeof feature?.properties?.id === "string"
          ? feature.properties.id
          : null;
      if (!id) return;
      callbacksRef.current.onSelectState(
        selectedStateRef.current === id ? null : id,
      );
    };

    const clearHover = () => {
      if (hoveredIdRef.current) {
        try {
          map.setFeatureState(
            { source: STATES_SOURCE, id: hoveredIdRef.current },
            { hovered: false },
          );
        } catch {
          /* source may not be ready */
        }
      }
      hoveredIdRef.current = null;
      callbacksRef.current.onHoverState(null, null);
      canvas.style.cursor = "grab";
    };

    const handleMoveEnd = () => {
      if (scheduleRef.current !== null) return;
      scheduleRef.current = window.requestAnimationFrame(() => {
        scheduleRef.current = null;
        renderMarkersRef.current();
      });
    };

    map.on("load", () => setMapReady(true));
    map.on("mousemove", handleMouseMove);
    map.on("click", handleClick);
    map.on("moveend", handleMoveEnd);
    map.on("zoomend", handleMoveEnd);
    map.on("mouseout", clearHover);
    canvas.addEventListener("mouseleave", clearHover);

    return () => {
      if (scheduleRef.current !== null)
        window.cancelAnimationFrame(scheduleRef.current);
      canvas.removeEventListener("mouseleave", clearHover);
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add the local boundary source and layers once both map and data are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geojson || map.getSource(STATES_SOURCE)) return;
    try {
      const source: GeoJSONSourceSpecification = {
        type: "geojson",
        data: geojson as unknown as GeoJSON.GeoJSON,
        promoteId: "id",
      };
      map.addSource(STATES_SOURCE, source);
      const fillLayer: FillLayerSpecification = {
        id: STATE_FILL_LAYER,
        type: "fill",
        source: STATES_SOURCE,
        paint: {
          "fill-color": STATE_FILL_EXPRESSION,
          "fill-opacity": 0.92,
        },
      };
      const lineLayer: LineLayerSpecification = {
        id: STATE_LINE_LAYER,
        type: "line",
        source: STATES_SOURCE,
        paint: {
          "line-color": STATE_LINE_EXPRESSION,
          "line-width": STATE_LINE_WIDTH_EXPRESSION,
        },
      };
      map.addLayer(fillLayer);
      map.addLayer(lineLayer);
      for (const state of statesRef.current) {
        try {
          map.setFeatureState(
            { source: STATES_SOURCE, id: state.id },
            {
              count: statsRef.current[state.id]?.reportedEvents ?? 0,
              selected: false,
              hovered: false,
            },
          );
        } catch {
          /* feature state is best-effort */
        }
      }
      setLayersReady(true);
    } catch (error) {
      console.error("maplibre_boundary_layers_failed", error);
      setMapError("The local state boundaries could not be added to the map.");
    }
  }, [mapReady, geojson]);

  // Reported volume feature state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;
    for (const state of states) {
      try {
        map.setFeatureState(
          { source: STATES_SOURCE, id: state.id },
          { count: stats[state.id]?.reportedEvents ?? 0 },
        );
      } catch {
        /* source may be unavailable during teardown */
      }
    }
  }, [layersReady, stats, states]);

  // Selection feature state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;
    for (const state of states) {
      try {
        map.setFeatureState(
          { source: STATES_SOURCE, id: state.id },
          { selected: state.id === selectedStateId },
        );
      } catch {
        /* source may be unavailable during teardown */
      }
    }
  }, [layersReady, selectedStateId, states]);

  // Fit to selection or the national extent (also handles the reset control).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const selected = states.find((state) => state.id === selectedStateId);
    map.fitBounds(
      selected
        ? ([
            [selected.bbox.minLng, selected.bbox.minLat],
            [selected.bbox.maxLng, selected.bbox.maxLat],
          ] as [[number, number], [number, number]])
        : NIGERIA_FIT_BOUNDS,
      {
        padding: selected ? 56 : 22,
        maxZoom: selected ? 7.4 : 6.4,
        duration: 450,
      },
    );
  }, [resetSignal, mapReady, selectedStateId, states]);

  renderMarkersRef.current = () => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    // State name labels: only where they can be read at the current zoom.
    const showAllLabels = zoom >= 6.15;
    for (const state of statesRef.current) {
      const visible = showAllLabels || state.areaKm2 >= 9_000;
      if (!visible) continue;
      const element = document.createElement("div");
      element.className = "nsm-state-label";
      if (state.id === selectedStateRef.current)
        element.classList.add("is-selected");
      element.textContent = state.name;
      element.setAttribute("aria-hidden", "true");
      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
        pitchAlignment: "viewport",
        rotationAlignment: "viewport",
      })
        .setLngLat([state.labelPoint.lng, state.labelPoint.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }

    const features = cluster.getClusters(bbox, Math.max(0, Math.floor(zoom)));
    for (const feature of features) {
      const [lng, lat] = feature.geometry.coordinates;
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      const properties = feature.properties;
      if ("cluster" in properties && properties.cluster === true) {
        const count = properties.point_count;
        const size = count < 5 ? 24 : count < 12 ? 29 : 34;
        const element = document.createElement("button");
        element.type = "button";
        element.tabIndex = -1;
        element.className = "nsm-cluster-marker";
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.style.fontSize = `${count < 10 ? 10 : 9}px`;
        element.textContent = String(count);
        element.setAttribute(
          "aria-label",
          `${count} reported ${L.events} clustered here. Click to zoom in.`,
        );
        element.title = `${count} reported ${L.events} · click to zoom`;
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          callbacksRef.current.onHoverEvent(null, null);
          const expansionZoom =
            cluster.getClusterExpansionZoom(properties.cluster_id) ?? zoom;
          map.easeTo({
            center: [lng, lat],
            zoom: Math.min(9.5, expansionZoom + 0.25),
            duration: 420,
          });
        });
        const marker = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.push(marker);
        continue;
      }

      const eventId = "eventId" in properties ? properties.eventId : null;
      const event = eventsRef.current.find(
        (candidate) => candidate.id === eventId,
      );
      if (!event) continue;
      const category = categoryConfig(event.category);
      const size = 8 + event.severity * 0.9;
      const element = document.createElement("button");
      element.type = "button";
      element.tabIndex = -1;
      element.className = "nsm-event-marker";
      element.classList.add("marker-in");
      if (selectedEventRef.current === event.id)
        element.classList.add("is-selected");
      if (event.severity >= 4) element.classList.add("is-high");
      element.style.setProperty("--marker-color", category.color);
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
      element.setAttribute(
        "aria-label",
        `Reported ${L.event}: ${event.title}. ${category.shortLabel}, severity ${event.severity}. Click to open.`,
      );
      element.title = `${category.shortLabel} · S${event.severity} · ${event.title}`;
      element.innerHTML = '<span class="nsm-event-marker-dot"></span>';
      element.addEventListener("click", (mouseEvent) => {
        mouseEvent.stopPropagation();
        callbacksRef.current.onHoverEvent(null, null);
        callbacksRef.current.onSelectEvent(event.id);
      });
      element.addEventListener("mouseenter", () => {
        if (hoveredIdRef.current) {
          try {
            map.setFeatureState(
              { source: STATES_SOURCE, id: hoveredIdRef.current },
              { hovered: false },
            );
          } catch {
            /* source may not be ready */
          }
          hoveredIdRef.current = null;
        }
        callbacksRef.current.onHoverState(null, null);
        const mapRect = map.getContainer().getBoundingClientRect();
        const markerRect = element.getBoundingClientRect();
        callbacksRef.current.onHoverEvent(event.id, {
          x: markerRect.left - mapRect.left + markerRect.width / 2,
          y: markerRect.top - mapRect.top,
        });
      });
      element.addEventListener("mouseleave", () => {
        callbacksRef.current.onHoverEvent(null, null);
      });
      const marker = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  };

  // Build the screen-space cluster index whenever the event set changes.
  useEffect(() => {
    const points: Array<Supercluster.PointFeature<EventPointProperties>> =
      events
        .filter((event) => event.coordinates)
        .map((event) => ({
          type: "Feature",
          properties: {
            eventId: event.id,
            category: event.category,
            severity: event.severity,
            title: event.title,
          },
          geometry: {
            type: "Point",
            coordinates: [
              event.coordinates?.lng ?? 0,
              event.coordinates?.lat ?? 0,
            ],
          },
        }));
    const index = new Supercluster<EventPointProperties, ClusterProperties>({
      radius: 46,
      maxZoom: 9,
      minPoints: 2,
      map: (properties) => ({ totalSeverity: properties.severity }),
      reduce: (accumulated, properties) => {
        accumulated.totalSeverity += properties.totalSeverity;
      },
    });
    index.load(points);
    clusterRef.current = index;
    if (scheduleRef.current !== null)
      window.cancelAnimationFrame(scheduleRef.current);
    scheduleRef.current = window.requestAnimationFrame(() => {
      scheduleRef.current = null;
      renderMarkersRef.current();
    });
  }, [events]);

  useEffect(() => {
    if (layersReady) renderMarkersRef.current();
  }, [layersReady, selectedEventId]);

  if (mapError) {
    return (
      <div className="grid h-full place-items-center px-5 text-center">
        <div className="max-w-sm">
          <p className="text-[13px] font-medium text-ink">
            The standard map could not be displayed
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {mapError}
          </p>
          <p className="mt-2 text-[10px] leading-relaxed text-faint">
            The lite SVG map uses the same authoritative boundaries and supports
            the same state selection without MapLibre or WebGL.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={onUseLite}
              className="rounded border border-info/50 bg-info px-2.5 py-1 text-[11px] font-medium text-canvas hover:bg-info/85"
            >
              Use lite map
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-line-2 bg-panel-2 px-2.5 py-1 text-[11px] text-ink hover:bg-panel-3"
            >
              Retry map
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label="Interactive map of Nigeria. Use the state directory or lite map for keyboard navigation."
      />
      {(!mapReady || geoPending) && !geoError ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded border border-line bg-canvas/80 px-3 py-2 text-center backdrop-blur-sm">
            <div className="mx-auto mb-1.5 h-1 w-24 overflow-hidden rounded-full bg-panel-3">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-info/60" />
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
              Loading Nigeria boundaries…
            </p>
          </div>
        </div>
      ) : null}
      {geoError ? (
        <div className="absolute inset-0 grid place-items-center px-4 text-center">
          <div>
            <p className="text-[12px] text-ink">
              The local state boundaries could not be loaded.
            </p>
            <p className="mt-1 text-[10px] text-muted">
              No external tile service is involved.
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
      ) : null}
    </div>
  );
}
