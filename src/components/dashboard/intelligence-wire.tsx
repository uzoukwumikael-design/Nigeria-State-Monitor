"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ListFilter, Radio, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCard } from "@/components/dashboard/event-card";
import { WireFilters } from "@/components/dashboard/wire-filters";
import { useDashboardStore } from "@/lib/store";
import { isDefaultFilters } from "@/lib/url";
import type { Category, Filters, IntelligenceEvent } from "@/lib/types";

import { useDatasetLabels } from "@/lib/dataset-labels";
const PAGE_SIZE = 20;

export function IntelligenceWire({
  events,
  filters,
  states,
  referenceTime,
  categoryCounts,
  allCategoryCount,
}: {
  events: IntelligenceEvent[];
  filters: Filters;
  states: Array<{ id: string; name: string }>;
  referenceTime: string;
  categoryCounts: Record<Category, number>;
  allCategoryCount: number;
}) {
  const L = useDatasetLabels();
  const selectEvent = useDashboardStore((state) => state.selectEvent);
  const resetFilters = useDashboardStore((state) => state.resetFilters);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const filterSignature = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [filterSignature]);

  const shown = events.slice(0, visible);
  const remaining = events.length - shown.length;

  return (
    <aside
      id="wire-panel"
      aria-label="Intelligence wire"
      className="flex h-full min-h-0 flex-col border-line bg-panel/35 lg:border-r"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <Radio className="size-3.5 text-info" aria-hidden />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          Intelligence wire
        </h2>
        <span className="rounded border border-line-2 bg-canvas-2 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
          Event-level
        </span>
        <span className="ml-auto font-mono text-[8.5px] tabular text-faint">
          {events.length}
        </span>
      </div>

      <WireFilters
        filters={filters}
        states={states}
        categoryCounts={categoryCounts}
        allCategoryCount={allCategoryCount}
        resultCount={events.length}
      />

      <div
        className="nsm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
        aria-live="polite"
      >
        {shown.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 px-6 text-center">
            <SearchX className="size-5 text-faint" aria-hidden />
            <p className="text-[12px] font-medium text-ink">
              No reported events match these filters
            </p>
            <p className="text-[10px] leading-relaxed text-muted">
              The wire only shows event-level {L.records} in the selected state,
              zone, category, severity, verification status and time window.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => resetFilters()}
              disabled={isDefaultFilters(filters)}
            >
              <ListFilter aria-hidden />
              Clear filters
            </Button>
          </div>
        ) : (
          <ul className="divide-y-0">
            {shown.map((event) => (
              <li key={event.id}>
                <EventCard
                  event={event}
                  referenceTime={referenceTime}
                  onOpen={selectEvent}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-canvas-2/60 px-2.5 py-1.5">
        {remaining > 0 ? (
          <Button
            variant="secondary"
            size="xs"
            className="w-full"
            onClick={() => setVisible((value) => value + PAGE_SIZE)}
          >
            <ChevronDown aria-hidden />
            Load {Math.min(PAGE_SIZE, remaining)} more
            <span className="text-faint">
              ({shown.length} of {events.length})
            </span>
          </Button>
        ) : (
          <p className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
            <span>
              Showing {events.length} of {events.length}
            </span>
            <span>One event · many reports</span>
          </p>
        )}
      </div>
    </aside>
  );
}
