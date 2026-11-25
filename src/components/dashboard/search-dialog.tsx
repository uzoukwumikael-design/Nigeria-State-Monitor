"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Loader2,
  MapPin,
  Search,
  SearchX,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/primitives";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { useDashboardStore } from "@/lib/store";
import type { Category, SearchHit, SearchResults, ZoneId } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDatasetLabels } from "@/lib/dataset-labels";
interface SearchApiResponse {
  data: SearchResults & { query: string };
}

async function fetchSearch(
  query: string,
  signal: AbortSignal,
): Promise<SearchResults> {
  const params = new URLSearchParams({ q: query, limit: "12" });
  const response = await fetch(`/api/search?${params.toString()}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const payload = (await response.json()) as SearchApiResponse;
  return payload.data;
}

const SUGGESTIONS = [
  "Lagos",
  "flood",
  "North East",
  "economy",
  "Kano",
  "security",
];

function HitIcon({ hit }: { hit: SearchHit }) {
  if (hit.kind === "state") return <MapPin className="size-3.5" aria-hidden />;
  if (hit.kind === "zone")
    return <Building2 className="size-3.5" aria-hidden />;
  if (hit.kind === "category")
    return <CategoryIcon category={hit.id as Category} className="size-3.5" />;
  return <CategoryIcon category={hit.icon as Category} className="size-3.5" />;
}

function kindLabel(hit: SearchHit): string {
  if (hit.kind === "state") return "State";
  if (hit.kind === "zone") return "Zone";
  if (hit.kind === "category") return "Category";
  return "Event";
}

export function SearchDialog() {
  const L = useDatasetLabels();
  const open = useDashboardStore((state) => state.searchOpen);
  const setOpen = useDashboardStore((state) => state.setSearchOpen);
  const selectState = useDashboardStore((state) => state.selectState);
  const selectEvent = useDashboardStore((state) => state.selectEvent);
  const setFilter = useDashboardStore((state) => state.setFilter);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDebounced("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) => fetchSearch(debounced, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
    retry: 1,
  });

  const groups = useMemo(
    () =>
      [
        {
          label: "Places",
          items: [...(data?.states ?? []), ...(data?.zones ?? [])],
        },
        { label: "Categories", items: data?.categories ?? [] },
        { label: "Reported events", items: data?.events ?? [] },
      ].filter((group) => group.items.length > 0),
    [data],
  );

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, flat.length]);

  useEffect(() => {
    if (!open) return;
    const target = document.getElementById(`nsm-search-hit-${activeIndex}`);
    target?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const choose = (hit: SearchHit) => {
    if (hit.kind === "state") {
      selectState(hit.id);
      setOpen(false);
      return;
    }
    if (hit.kind === "zone") {
      setFilter("zone", hit.id as ZoneId);
      setOpen(false);
      return;
    }
    if (hit.kind === "category") {
      setFilter("category", hit.id as Category);
      setOpen(false);
      return;
    }
    selectEvent(hit.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flat.length === 0) return;
      setActiveIndex((index) => (index + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      const hit = flat[activeIndex];
      if (hit) {
        event.preventDefault();
        choose(hit);
      }
    }
  };

  const showHints = debounced.length < 2;
  const showNoResults =
    !showHints && !isFetching && !isError && data && flat.length === 0;

  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-2xl overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          Search Nigeria State Monitor
        </DialogTitle>
        <DialogDescription className="sr-only">
          Search the {L.snapshot} for states, geopolitical zones, categories and
          event records. Use the arrow keys and Enter to select a result.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search className="size-4 shrink-0 text-faint" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search states, zones, categories or reported events…"
            aria-label="Search query"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="nsm-search-results"
            aria-autocomplete="list"
            aria-activedescendant={
              flat[activeIndex] ? `nsm-search-hit-${activeIndex}` : undefined
            }
            className="h-9 border-transparent bg-transparent px-0 text-[13px] focus-visible:border-transparent"
          />
          {isFetching ? (
            <Loader2
              className="size-3.5 shrink-0 animate-spin text-info"
              aria-label="Searching"
            />
          ) : (
            <kbd className="shrink-0 rounded border border-line-2 bg-canvas-2 px-1.5 py-0.5 font-mono text-[8px] text-faint">
              ESC
            </kbd>
          )}
        </div>

        <div
          id="nsm-search-results"
          role="listbox"
          aria-label="Search results"
          className="nsm-scroll max-h-[56dvh] overflow-y-auto"
        >
          {showHints ? (
            <div className="px-3 py-3">
              <p className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                <Sparkles className="size-3" aria-hidden /> Try a place or topic
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setQuery(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="rounded border border-line bg-canvas-2 px-2 py-1 text-[10.5px] text-muted transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-info"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-faint">
                Search covers the{" "}
                {L.isDemo ? "static fictional demo snapshot" : "loaded records"}
                : 37 first-order units, six geopolitical zones, six categories
                and every reported {L.event}. No external search provider is
                used.
              </p>
            </div>
          ) : isError ? (
            <div className="px-4 py-8 text-center">
              <ShieldAlert
                className="mx-auto size-5 text-critical"
                aria-hidden
              />
              <p className="mt-2 text-[12px] text-ink">Search is unavailable</p>
              <p className="mt-1 text-[10px] text-muted">
                {error instanceof Error
                  ? error.message
                  : "The search endpoint did not respond."}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-2 rounded border border-line-2 bg-panel-2 px-2.5 py-1 text-[10px] text-ink hover:bg-panel-3"
              >
                Retry search
              </button>
            </div>
          ) : showNoResults ? (
            <div className="px-4 py-8 text-center">
              <SearchX className="mx-auto size-5 text-faint" aria-hidden />
              <p className="mt-2 text-[12px] text-ink">
                No {L.records} match “{debounced}”
              </p>
              <p className="mt-1 text-[10px] text-muted">
                Try a state name, capital, geopolitical zone, category or a word
                from an event title.
              </p>
            </div>
          ) : isFetching && !data ? (
            <div className="space-y-1.5 px-3 py-3">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="h-9 animate-pulse rounded bg-panel-2"
                />
              ))}
            </div>
          ) : (
            <div className="py-1">
              {groups.map((group) => (
                <div key={group.label} className="mb-1 last:mb-0">
                  <p className="px-3 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                    {group.label}
                    <span className="ml-1 text-faint/60">
                      {group.items.length}
                    </span>
                  </p>
                  {group.items.map((hit) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const active = index === activeIndex;
                    return (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        id={`nsm-search-hit-${index}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(hit)}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-info",
                          active ? "bg-info/10" : "hover:bg-panel-2/60",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-6 shrink-0 place-items-center rounded border",
                            active
                              ? "border-info/40 bg-info/10 text-info"
                              : "border-line bg-canvas-2 text-faint",
                          )}
                        >
                          <HitIcon hit={hit} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[11.5px] font-medium text-ink">
                              {hit.title}
                            </span>
                            <span className="shrink-0 rounded border border-line px-1 py-px font-mono text-[7px] uppercase tracking-[0.06em] text-faint">
                              {kindLabel(hit)}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-1 block text-[9.5px] leading-snug text-muted">
                            {hit.subtitle}
                          </span>
                        </span>
                        <ArrowRight
                          className={cn(
                            "mt-1 size-3 shrink-0",
                            active ? "text-info" : "text-faint/50",
                          )}
                          aria-hidden
                        />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-canvas-2/50 px-3 py-1.5 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto text-warning/80">
            {L.isDemo
              ? "Demo snapshot · not live"
              : "Published records"}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
