"use client";

import { create } from "zustand";

interface ConnectivityState {
  online: boolean;
  /** ISO time of the oldest saved response served since the last successful live load, if any. */
  cachedAt: string | null;
  cachedCount: number;
  setOnline(online: boolean): void;
  noteCached(cachedAt: string | null): void;
  clearCached(): void;
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: true,
  cachedAt: null,
  cachedCount: 0,
  setOnline: (online) => set({ online }),
  noteCached: (cachedAt) =>
    set((state) => ({
      cachedCount: state.cachedCount + 1,
      cachedAt:
        cachedAt && (!state.cachedAt || cachedAt < state.cachedAt) ? cachedAt : state.cachedAt,
    })),
  clearCached: () => set({ cachedAt: null, cachedCount: 0 }),
}));
