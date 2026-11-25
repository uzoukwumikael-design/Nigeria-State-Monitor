"use client";

import { create } from "zustand";
import {
  DEFAULT_FILTERS,
  type Filters,
  type RegionalTrendDays,
  type ZoneId,
} from "@/lib/types";
import { STATE_BY_ID } from "@/lib/geo/states";

export type MobileView = "map" | "wire" | "brief" | "analytics";
export type LiteSource = "unset" | "auto" | "manual";

interface DashboardState {
  filters: Filters;
  selectedEventId: string | null;
  hoveredStateId: string | null;
  mobileView: MobileView;
  liteMode: boolean;
  liteSource: LiteSource;
  liteResolved: boolean;
  searchOpen: boolean;
  regionalOpen: boolean;
  regionalZone: ZoneId | null;
  regionalDays: RegionalTrendDays;
  directoryOpen: boolean;
  methodologyOpen: boolean;
  economyOpen: boolean;
  historyOpen: boolean;
  sourcesOpen: boolean;
  setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void;
  patchFilters(patch: Partial<Filters>): void;
  resetFilters(): void;
  selectState(stateId: string | null): void;
  toggleState(stateId: string): void;
  selectEvent(eventId: string | null): void;
  setHoveredState(stateId: string | null): void;
  setMobileView(view: MobileView): void;
  setLiteMode(enabled: boolean, source?: LiteSource): void;
  resolveLiteMode(enabled: boolean): void;
  setSearchOpen(open: boolean): void;
  setRegionalOpen(open: boolean): void;
  setRegionalZone(zone: ZoneId | null): void;
  setRegionalDays(days: RegionalTrendDays): void;
  setDirectoryOpen(open: boolean): void;
  setMethodologyOpen(open: boolean): void;
  setEconomyOpen(open: boolean): void;
  setHistoryOpen(open: boolean): void;
  setSourcesOpen(open: boolean): void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  filters: { ...DEFAULT_FILTERS },
  selectedEventId: null,
  hoveredStateId: null,
  mobileView: "map",
  liteMode: false,
  liteSource: "unset",
  liteResolved: false,
  searchOpen: false,
  regionalOpen: false,
  regionalZone: null,
  regionalDays: 14,
  directoryOpen: false,
  methodologyOpen: false,
  economyOpen: false,
  historyOpen: false,
  sourcesOpen: false,

  setFilter: (key, value) =>
    set((state) => {
      const next: Filters = { ...state.filters, [key]: value };
      if (key === "stateId" && value) {
        const selectedZone = STATE_BY_ID.get(value as string)?.zone;
        if (next.zone !== "all" && next.zone !== selectedZone) next.zone = "all";
      }
      if (key === "zone" && value !== "all" && next.stateId) {
        if (STATE_BY_ID.get(next.stateId)?.zone !== value) next.stateId = null;
      }
      return { filters: next };
    }),

  patchFilters: (patch) =>
    set((state) => {
      const next: Filters = { ...state.filters, ...patch };
      if (next.stateId && next.zone !== "all" && STATE_BY_ID.get(next.stateId)?.zone !== next.zone) {
        next.zone = "all";
      }
      return { filters: next };
    }),

  resetFilters: () =>
    set((state) => ({
      filters: { ...DEFAULT_FILTERS },
      selectedEventId: null,
      hoveredStateId: null,
      mobileView: state.mobileView,
    })),

  selectState: (stateId) =>
    set((state) => {
      if (stateId && !STATE_BY_ID.has(stateId)) return {};
      const next: Filters = { ...state.filters, stateId };
      if (stateId && next.zone !== "all" && STATE_BY_ID.get(stateId)?.zone !== next.zone) {
        next.zone = "all";
      }
      return {
        filters: next,
        hoveredStateId: null,
        selectedEventId: null,
      };
    }),

  toggleState: (stateId) => {
    const current = get().filters.stateId;
    get().selectState(current === stateId ? null : stateId);
  },

  selectEvent: (eventId) => set({ selectedEventId: eventId, searchOpen: false }),

  setHoveredState: (stateId) => set({ hoveredStateId: stateId }),

  setMobileView: (view) => set({ mobileView: view }),

  setLiteMode: (enabled, source = "manual") =>
    set({ liteMode: enabled, liteSource: source, liteResolved: true }),

  resolveLiteMode: (enabled) =>
    set((state) => {
      if (state.liteSource === "manual") return { liteResolved: true };
      return { liteMode: enabled, liteSource: "auto", liteResolved: true };
    }),

  setSearchOpen: (open) => set({ searchOpen: open }),
  setRegionalOpen: (open) =>
    set((state) => {
      if (!open) return { regionalOpen: false };
      const zone =
        state.filters.zone !== "all" ? state.filters.zone : state.regionalZone;
      return { regionalOpen: true, regionalZone: zone };
    }),
  setRegionalZone: (zone) => set({ regionalZone: zone }),
  setRegionalDays: (days) => set({ regionalDays: days }),
  setDirectoryOpen: (open) => set({ directoryOpen: open }),
  setMethodologyOpen: (open) => set({ methodologyOpen: open }),
  setEconomyOpen: (open) => set({ economyOpen: open }),
  setHistoryOpen: (open) => set({ historyOpen: open }),
  setSourcesOpen: (open) => set({ sourcesOpen: open }),
}));
