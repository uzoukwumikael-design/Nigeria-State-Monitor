"use client";

import { useMemo, useState } from "react";
import { CircleSlash, Compass, MapPin, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ZONES } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import type { StateStats } from "@/lib/intelligence";
import { useDashboardStore } from "@/lib/store";
import type { StateGeo } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
export function StateDirectoryDialog({
  states,
  stats,
}: {
  states: readonly StateGeo[];
  stats: Record<string, StateStats>;
}) {
  const L = useDatasetLabels();
  const open = useDashboardStore((state) => state.directoryOpen);
  const setOpen = useDashboardStore((state) => state.setDirectoryOpen);
  const selectState = useDashboardStore((state) => state.selectState);
  const setMobileView = useDashboardStore((state) => state.setMobileView);
  const selectedStateId = useDashboardStore((state) => state.filters.stateId);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return states;
    return states.filter((state) =>
      [state.name, state.capital, state.zoneName, state.id]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, states]);

  const totalReports = states.reduce(
    (sum, state) => sum + (stats[state.id]?.reportedEvents ?? 0),
    0,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent
        className="max-w-2xl overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Compass className="size-4 text-info" aria-hidden />
            State directory
          </DialogTitle>
          <DialogDescription className="mt-1 text-[10.5px]">
            All 36 states and the Federal Capital Territory from the checked-in
            administrative registry. Selecting a state applies it as a dashboard
            filter and opens its brief.
          </DialogDescription>
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by state, capital, zone or ID…"
                aria-label="Filter state directory"
                className="h-8 pl-7"
              />
            </div>
            {selectedStateId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  selectState(null);
                  setOpen(false);
                }}
              >
                <X aria-hidden /> Clear
              </Button>
            ) : null}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[8px] uppercase tracking-[0.06em] text-faint">
            <span>{filtered.length} of 37 first-order units</span>
            <span className="text-line-2">·</span>
            <span>
              {formatNumber(totalReports)} reported {L.events} in view
            </span>
            <span className="ml-auto text-warning/80">Volume · not risk</span>
          </p>
        </div>

        <div className="nsm-scroll max-h-[62dvh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <CircleSlash className="mx-auto size-5 text-faint" aria-hidden />
              <p className="mt-2 text-[12px] text-ink">
                No state matches “{query}”
              </p>
              <p className="mt-1 text-[10px] text-muted">
                Try a state name, capital city, geopolitical zone or an ID such
                as NG-LA.
              </p>
            </div>
          ) : (
            ZONES.map((zone) => {
              const zoneStates = filtered
                .filter((state) => state.zone === zone.id)
                .sort((a, b) => a.name.localeCompare(b.name));
              if (zoneStates.length === 0) return null;
              return (
                <section key={zone.id} aria-label={`${zone.name} zone states`}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-line/70 bg-panel/95 px-4 py-1.5 backdrop-blur-sm">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: zone.color }}
                      aria-hidden
                    />
                    <h3 className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
                      {zone.name}
                    </h3>
                    <span className="font-mono text-[8px] text-faint">
                      {zoneStates.length} states
                    </span>
                    <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.06em] text-faint">
                      {zone.shortName}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2">
                    {zoneStates.map((state) => {
                      const stateStats = stats[state.id];
                      const count = stateStats?.reportedEvents ?? 0;
                      const selected = selectedStateId === state.id;
                      return (
                        <button
                          key={state.id}
                          type="button"
                          onClick={() => {
                            selectState(state.id);
                            setMobileView("brief");
                            setOpen(false);
                          }}
                          aria-pressed={selected}
                          className={cn(
                            "group flex items-center gap-2 border-b border-line/60 px-4 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-info sm:odd:border-r",
                            selected ? "bg-info/[0.08]" : "hover:bg-panel-2/55",
                          )}
                        >
                          <MapPin
                            className={cn(
                              "size-3 shrink-0",
                              selected ? "text-info" : "text-faint/60",
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium text-ink">
                              {state.name}
                            </span>
                            <span className="block truncate font-mono text-[8px] uppercase tracking-[0.04em] text-faint">
                              {state.capital} · {state.id}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span
                              className={cn(
                                "block font-mono text-[11px] tabular",
                                count > 0 ? "text-ink" : "text-faint/60",
                              )}
                            >
                              {count}
                            </span>
                            <span className="block font-mono text-[7px] uppercase tracking-[0.05em] text-faint">
                              events
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <div className="border-t border-line bg-canvas-2/50 px-4 py-1.5">
          <p className="font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
            Counts reflect the active category, severity, verification and time
            filters · zero does not imply safety
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
