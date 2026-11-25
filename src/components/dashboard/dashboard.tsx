"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { DatasetLabelsProvider } from "@/lib/dataset-labels";
import { BarChart3, Map as MapIcon, PanelRight, Radio } from "lucide-react";
import { AnalyticsStrip } from "@/components/dashboard/analytics-strip";
import { BriefPanel } from "@/components/dashboard/brief-panel";
import { ConnectivityBanner } from "@/components/dashboard/connectivity-banner";
import { DemoBanner } from "@/components/dashboard/demo-banner";
import { EventDialog } from "@/components/dashboard/event-dialog";
import { IntelligenceWire } from "@/components/dashboard/intelligence-wire";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { MethodologyDialog } from "@/components/dashboard/methodology-dialog";
import { RegionalDialog } from "@/components/dashboard/regional-dialog";
import { SearchDialog } from "@/components/dashboard/search-dialog";
import { StateDirectoryDialog } from "@/components/dashboard/state-directory-dialog";
import { TopBar } from "@/components/dashboard/top-bar";
import { MapPanel } from "@/components/map/map-panel";
import { STATE_BY_ID } from "@/lib/geo/states";
import {
  allStateStats,
  countByCategory,
  filterEvents,
  nationalSummary,
  previousPeriodEvents,
} from "@/lib/intelligence";
import { useDashboardStore, type MobileView } from "@/lib/store";
import type { DashboardSnapshot, TimeWindow } from "@/lib/types";
import {
  filtersToSearchParams,
  viewFromSearchParams,
  type UrlView,
  resolveInitialView,
} from "@/lib/url";
import { cn } from "@/lib/utils";

// Heavy chart-bearing dialogs are fetched only the first time someone opens them,
// keeping first-load JavaScript small for slow connections.
const EconomyDialog = dynamic(
  () =>
    import("@/components/dashboard/economy-dialog").then(
      (module) => module.EconomyDialog,
    ),
  { ssr: false },
);
const SourcesDialog = dynamic(
  () => import("@/components/dashboard/sources-dialog").then((module) => module.SourcesDialog),
  { ssr: false },
);
const HistoryDialog = dynamic(
  () =>
    import("@/components/dashboard/history-dialog").then(
      (module) => module.HistoryDialog,
    ),
  { ssr: false },
);

/** True from the first time `value` becomes true onwards. */
function useEverTrue(value: boolean): boolean {
  const [ever, setEver] = useState(value);
  if (value && !ever) setEver(true);
  return ever;
}

const MOBILE_TABS: Array<{
  id: MobileView;
  label: string;
  icon: typeof MapIcon;
}> = [
  { id: "map", label: "Map", icon: MapIcon },
  { id: "wire", label: "Wire", icon: Radio },
  { id: "brief", label: "Brief", icon: PanelRight },
  { id: "analytics", label: "Stats", icon: BarChart3 },
];

const WINDOW_LABEL: Record<TimeWindow, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 365 days",
  all: "All time",
};

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function Dashboard({
  snapshot,
  initialView,
}: {
  snapshot: DashboardSnapshot;
  initialView: UrlView;
}) {
  const filters = useDashboardStore((state) => state.filters);
  const economyEver = useEverTrue(
    useDashboardStore((state) => state.economyOpen),
  );
  const historyEver = useEverTrue(
    useDashboardStore((state) => state.historyOpen),
  );
  const sourcesEver = useEverTrue(
    useDashboardStore((state) => state.sourcesOpen),
  );
  const selectedEventId = useDashboardStore((state) => state.selectedEventId);
  const mobileView = useDashboardStore((state) => state.mobileView);
  const setMobileView = useDashboardStore((state) => state.setMobileView);
  const liteMode = useDashboardStore((state) => state.liteMode);
  const liteSource = useDashboardStore((state) => state.liteSource);
  const liteResolved = useDashboardStore((state) => state.liteResolved);
  const setLiteMode = useDashboardStore((state) => state.setLiteMode);
  const resolveLiteMode = useDashboardStore((state) => state.resolveLiteMode);
  const selectEvent = useDashboardStore((state) => state.selectEvent);

  const hydrated = useRef(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const eventById = useMemo(
    () => new Map(snapshot.events.map((event) => [event.id, event])),
    [snapshot.events],
  );

  const applyView = useCallback(
    (view: UrlView) => {
      useDashboardStore.setState({
        filters: view.filters,
        selectedEventId:
          view.eventId && eventById.has(view.eventId) ? view.eventId : null,
        regionalOpen: view.regionalOpen,
        regionalZone: view.regionalZone,
        regionalDays: view.regionalDays,
      });
    },
    [eventById],
  );

  useIsomorphicLayoutEffect(() => {
    applyView(resolveInitialView(initialView, window.location.search));
    hydrated.current = true;
  }, [applyView, initialView]);

  // Keep the address bar in sync with filters and the open event.
  useEffect(() => {
    return useDashboardStore.subscribe((state) => {
      if (!hydrated.current) return;
      const params = filtersToSearchParams(
        state.filters,
        state.selectedEventId,
        {
          open: state.regionalOpen,
          zone: state.regionalZone,
          days: state.regionalDays,
        },
      ).toString();
      const next = `${window.location.pathname}${params ? `?${params}` : ""}${window.location.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current)
        window.history.replaceState(window.history.state, "", next);
    });
  }, []);

  // Back/forward navigation restores the URL-derived view.
  useEffect(() => {
    const handlePopState = () => {
      const view = viewFromSearchParams(
        new URLSearchParams(window.location.search),
      );
      applyView(view);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyView]);

  // Low-bandwidth preference: manual choice wins, otherwise honour Save-Data/2G.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("nsm-lite");
    } catch {
      stored = null;
    }
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    const slowNetwork =
      Boolean(connection?.saveData) ||
      ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "");
    if (stored === "on") setLiteMode(true, "manual");
    else if (stored === "off") setLiteMode(false, "manual");
    else resolveLiteMode(slowNetwork);
  }, [resolveLiteMode, setLiteMode]);

  useEffect(() => {
    if (!liteResolved || liteSource !== "manual") return;
    try {
      window.localStorage.setItem("nsm-lite", liteMode ? "on" : "off");
    } catch {
      /* storage may be blocked; the session preference still works */
    }
  }, [liteMode, liteResolved, liteSource]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        Boolean(target?.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useDashboardStore.getState().setSearchOpen(true);
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        useDashboardStore.getState().setSearchOpen(true);
        return;
      }
      if (event.key === "Escape" && !typing) {
        const state = useDashboardStore.getState();
        if (state.selectedEventId) state.selectEvent(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredEvents = useMemo(
    () => filterEvents(snapshot.events, filters, snapshot.referenceTime),
    [snapshot.events, snapshot.referenceTime, filters],
  );

  const summary = useMemo(
    () => nationalSummary(filteredEvents, filters, snapshot.referenceTime, snapshot.mode),
    [filteredEvents, filters, snapshot.referenceTime, snapshot.mode],
  );

  const previousReported = useMemo(
    () =>
      previousPeriodEvents(snapshot.events, filters, snapshot.referenceTime)
        .length,
    [snapshot.events, filters, snapshot.referenceTime],
  );

  const stateStats = useMemo(
    () =>
      allStateStats(filteredEvents, snapshot.states, snapshot.referenceTime),
    [filteredEvents, snapshot.states, snapshot.referenceTime],
  );

  const categoryScope = useMemo(
    () =>
      filterEvents(
        snapshot.events,
        { ...filters, category: "all" },
        snapshot.referenceTime,
      ),
    [snapshot.events, snapshot.referenceTime, filters],
  );

  const categoryCounts = useMemo(
    () => countByCategory(categoryScope),
    [categoryScope],
  );

  const states = useMemo(
    () => snapshot.states.map((state) => ({ id: state.id, name: state.name })),
    [snapshot.states],
  );

  const selectedState = STATE_BY_ID.get(filters.stateId ?? "") ?? null;
  const selectedEvent = selectedEventId
    ? (eventById.get(selectedEventId) ?? null)
    : null;
  const windowLabel = WINDOW_LABEL[filters.window];

  return (
    <DatasetLabelsProvider mode={snapshot.mode}>
      <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-canvas">
        <a
          href="#nsm-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:border focus:border-info focus:bg-panel focus:px-3 focus:py-1.5 focus:text-[11px] focus:text-ink"
        >
          Skip to dashboard
        </a>

        <TopBar
          referenceTime={snapshot.referenceTime}
          liteMode={liteMode}
          demo={snapshot.mode === "demo"}
        />
        <ConnectivityBanner datasetAsOf={snapshot.generatedAt} />
        <DemoBanner
          disclaimer={snapshot.disclaimer}
          generatedAt={snapshot.generatedAt}
          mode={snapshot.mode}
        />
        <KpiStrip
          summary={summary}
          previousReported={previousReported}
          scopeLabel={summary.scopeLabel}
          windowLabel={windowLabel}
        />

        <main id="nsm-main" className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "min-h-0 flex-1 grid-rows-1 lg:grid-cols-[minmax(286px,318px)_minmax(0,1fr)_minmax(286px,334px)]",
              mobileView === "analytics" ? "hidden lg:grid" : "grid",
            )}
          >
            <div
              className={cn(
                "min-h-0 min-w-0 flex-col",
                mobileView === "wire" ? "flex" : "hidden",
                "lg:flex",
              )}
            >
              <IntelligenceWire
                events={filteredEvents}
                filters={filters}
                states={states}
                referenceTime={snapshot.referenceTime}
                categoryCounts={categoryCounts}
                allCategoryCount={categoryScope.length}
              />
            </div>

            <div
              className={cn(
                "min-h-0 min-w-0 flex-col",
                mobileView === "map" ? "flex" : "hidden",
                "lg:flex",
              )}
            >
              <MapPanel
                states={snapshot.states}
                stats={stateStats}
                events={filteredEvents}
                referenceTime={snapshot.referenceTime}
              />
            </div>

            <div
              className={cn(
                "min-h-0 min-w-0 flex-col",
                mobileView === "brief" ? "flex" : "hidden",
                "lg:flex",
              )}
            >
              <BriefPanel
                summary={summary}
                state={selectedState}
                scopeEvents={filteredEvents}
                referenceTime={snapshot.referenceTime}
                states={snapshot.states}
                filters={filters}
              />
            </div>
          </div>

          {!isDesktop && mobileView === "analytics" ? (
            <div className="min-h-0 flex-1">
              <AnalyticsStrip
                variant="mobile"
                events={filteredEvents}
                summary={summary}
                referenceTime={snapshot.referenceTime}
                liteMode={liteMode}
              />
            </div>
          ) : null}

          {isDesktop ? (
            <AnalyticsStrip
              variant="desktop"
              events={filteredEvents}
              summary={summary}
              referenceTime={snapshot.referenceTime}
              liteMode={liteMode}
            />
          ) : null}
        </main>

        <nav
          aria-label="Dashboard views"
          className="flex h-11 shrink-0 items-stretch border-t border-line bg-canvas lg:hidden"
        >
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = mobileView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setMobileView(tab.id)}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 border-r border-line/60 text-[8px] font-medium uppercase tracking-[0.08em] transition-colors last:border-r-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-info",
                  active
                    ? "bg-info/[0.08] text-info"
                    : "text-faint hover:text-muted",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {tab.label}
                {tab.id === "wire" ? (
                  <span className="absolute right-[22%] top-1.5 rounded-full bg-panel-3 px-1 font-mono text-[7px] tabular text-muted">
                    {filteredEvents.length}
                  </span>
                ) : null}
                {active ? (
                  <span
                    className="absolute inset-x-4 top-0 h-px bg-info"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        <SearchDialog />
        <RegionalDialog referenceTime={snapshot.referenceTime} />
        <StateDirectoryDialog states={snapshot.states} stats={stateStats} />
        <MethodologyDialog />
        {economyEver ? (
          <EconomyDialog
            events={snapshot.events}
            referenceTime={snapshot.referenceTime}
          />
        ) : null}
        {historyEver ? (
          <HistoryDialog referenceTime={snapshot.referenceTime} />
        ) : null}
        {sourcesEver ? (
          <SourcesDialog referenceTime={snapshot.referenceTime} />
        ) : null}
        <EventDialog
          event={selectedEvent}
          events={snapshot.events}
          referenceTime={snapshot.referenceTime}
          onClose={() => selectEvent(null)}
        />
      </div>
    </DatasetLabelsProvider>
  );
}
