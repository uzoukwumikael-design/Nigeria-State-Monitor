"use client";

import { Filter, RotateCcw, X } from "lucide-react";
import {
  CATEGORIES,
  SEVERITY_CONFIG,
  VERIFICATION_CONFIG,
  ZONES,
  categoryConfig,
  zoneConfig,
} from "@/lib/config";
import { TIME_WINDOW_IDS, type Category, type Filters } from "@/lib/types";
import { STATE_BY_ID } from "@/lib/geo/states";
import { activeFilterCount, isDefaultFilters } from "@/lib/url";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
const WINDOW_LABELS: Record<(typeof TIME_WINDOW_IDS)[number], string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  "365d": "1Y",
  all: "ALL",
};

export function ActiveFilterChips({ filters }: { filters: Filters }) {
  const patchFilters = useDashboardStore((state) => state.patchFilters);
  const selectState = useDashboardStore((state) => state.selectState);
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  if (filters.stateId) {
    const state = STATE_BY_ID.get(filters.stateId);
    chips.push({
      key: "state",
      label: state?.name ?? filters.stateId,
      onRemove: () => selectState(null),
    });
  }
  if (filters.zone !== "all") {
    chips.push({
      key: "zone",
      label: `${zoneConfig(filters.zone).name} zone`,
      onRemove: () => patchFilters({ zone: "all" }),
    });
  }
  if (filters.category !== "all") {
    chips.push({
      key: "category",
      label: categoryConfig(filters.category).shortLabel,
      onRemove: () => patchFilters({ category: "all" }),
    });
  }
  if (filters.severity !== "all") {
    chips.push({
      key: "severity",
      label: `Severity ${filters.severity} · ${SEVERITY_CONFIG[filters.severity].label}`,
      onRemove: () => patchFilters({ severity: "all" }),
    });
  }
  if (filters.verification !== "all") {
    chips.push({
      key: "verification",
      label: VERIFICATION_CONFIG[filters.verification].label,
      onRemove: () => patchFilters({ verification: "all" }),
    });
  }
  if (filters.q) {
    chips.push({
      key: "q",
      label: `“${filters.q}”`,
      onRemove: () => patchFilters({ q: "" }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className="inline-flex h-5 items-center gap-1 rounded border border-info/25 bg-info/10 px-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-info transition-colors hover:bg-info/15 focus-visible:outline-2 focus-visible:outline-info"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <X className="size-2.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function WireFilters({
  filters,
  states,
  categoryCounts,
  allCategoryCount,
  resultCount,
}: {
  filters: Filters;
  states: Array<{ id: string; name: string }>;
  categoryCounts: Record<Category, number>;
  allCategoryCount: number;
  resultCount: number;
}) {
  const L = useDatasetLabels();
  const setFilter = useDashboardStore((state) => state.setFilter);
  const patchFilters = useDashboardStore((state) => state.patchFilters);
  const resetFilters = useDashboardStore((state) => state.resetFilters);
  const advancedCount =
    (filters.stateId ? 1 : 0) +
    (filters.zone !== "all" ? 1 : 0) +
    (filters.severity !== "all" ? 1 : 0) +
    (filters.verification !== "all" ? 1 : 0);

  return (
    <div className="border-b border-line/80 px-2.5 pb-2 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-faint">
          Category
        </p>
        <p
          className="font-mono text-[8.5px] tabular text-faint"
          aria-live="polite"
        >
          {resultCount} reported {resultCount === 1 ? "event" : "events"}
        </p>
      </div>

      <div
        className="nsm-scroll -mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-1.5"
        role="group"
        aria-label="Category filter"
      >
        <button
          type="button"
          onClick={() => setFilter("category", "all")}
          aria-pressed={filters.category === "all"}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-info",
            filters.category === "all"
              ? "border-ink/25 bg-panel-3 text-ink"
              : "border-line bg-canvas-2 text-faint hover:border-line-2 hover:text-muted",
          )}
        >
          All
          <span className="tabular text-faint">{allCategoryCount}</span>
        </button>
        {CATEGORIES.map((category) => {
          const active = filters.category === category.id;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() =>
                setFilter("category", active ? "all" : category.id)
              }
              aria-pressed={active}
              className={cn(
                "inline-flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-info",
                active
                  ? "border-line-2 bg-panel-3 text-ink"
                  : "border-line bg-canvas-2 text-faint hover:border-line-2 hover:text-muted",
              )}
              style={
                active
                  ? {
                      borderColor: `${category.color}66`,
                      color: category.color,
                    }
                  : undefined
              }
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: category.color }}
                aria-hidden
              />
              {category.shortLabel}
              <span className="tabular text-faint">
                {categoryCounts[category.id]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <div
          className="inline-flex h-6 items-center rounded border border-line bg-canvas-2 p-0.5"
          role="group"
          aria-label="Time window"
        >
          {TIME_WINDOW_IDS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setFilter("window", window)}
              aria-pressed={filters.window === window}
              className={cn(
                "h-5 rounded-sm px-1.5 font-mono text-[8.5px] uppercase tracking-[0.05em] transition-colors focus-visible:outline-2 focus-visible:outline-info",
                filters.window === window
                  ? "bg-panel-3 text-ink"
                  : "text-faint hover:text-muted",
              )}
              title={
                window === "all"
                  ? `All time in the ${L.snapshotShort}`
                  : `Events with occurrence time in the last ${window.replace("d", " days").replace("h", " hours")}`
              }
            >
              {WINDOW_LABELS[window]}
            </button>
          ))}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="xs" className="h-6 gap-1 px-1.5">
              <Filter className="size-2.5" aria-hidden />
              Filters
              {advancedCount > 0 ? (
                <span className="grid size-3.5 place-items-center rounded-full bg-info/20 font-mono text-[8px] text-info">
                  {advancedCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[292px]" align="start">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
                Advanced filters
              </p>
              <button
                type="button"
                onClick={() => resetFilters()}
                className="inline-flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-wide text-faint hover:text-ink"
              >
                <RotateCcw className="size-2.5" aria-hidden /> Reset all
              </button>
            </div>
            <div className="space-y-2.5">
              <label className="block">
                <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                  State
                </span>
                <NativeSelect
                  value={filters.stateId ?? ""}
                  onChange={(event) =>
                    patchFilters({ stateId: event.target.value || null })
                  }
                  className="w-full"
                  aria-label="Filter by state"
                >
                  <option value="">All 37 states + FCT</option>
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                    Zone
                  </span>
                  <NativeSelect
                    value={filters.zone}
                    onChange={(event) =>
                      setFilter("zone", event.target.value as Filters["zone"])
                    }
                    className="w-full"
                    aria-label="Filter by geopolitical zone"
                  >
                    <option value="all">All zones</option>
                    {ZONES.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="block">
                  <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                    Severity
                  </span>
                  <NativeSelect
                    value={
                      filters.severity === "all"
                        ? "all"
                        : String(filters.severity)
                    }
                    onChange={(event) =>
                      setFilter(
                        "severity",
                        event.target.value === "all"
                          ? "all"
                          : (Number(event.target.value) as Filters["severity"]),
                      )
                    }
                    className="w-full"
                    aria-label="Filter by severity"
                  >
                    <option value="all">All levels</option>
                    {([1, 2, 3, 4, 5] as const).map((severity) => (
                      <option key={severity} value={severity}>
                        {severity} · {SEVERITY_CONFIG[severity].label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                  Verification status
                </span>
                <NativeSelect
                  value={filters.verification}
                  onChange={(event) =>
                    setFilter(
                      "verification",
                      event.target.value as Filters["verification"],
                    )
                  }
                  className="w-full"
                  aria-label="Filter by verification status"
                >
                  <option value="all">All statuses</option>
                  {Object.entries(VERIFICATION_CONFIG).map(
                    ([status, config]) => (
                      <option key={status} value={status}>
                        {config.label}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </label>
              <div className="flex items-center justify-between border-t border-line pt-2">
                <p className="font-mono text-[8px] uppercase tracking-wide text-faint">
                  {activeFilterCount(filters)} active
                </p>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => resetFilters()}
                  disabled={isDefaultFilters(filters)}
                >
                  Clear all
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.06em] text-faint">
          Latest update
        </span>
      </div>

      <div className="mt-1.5">
        <ActiveFilterChips filters={filters} />
      </div>
    </div>
  );
}
