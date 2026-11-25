"use client";

import { useState } from "react";
import {
  Building2,
  Compass,
  History,
  Info,
  Landmark,
  LayoutGrid,
  MapPinned,
  Menu,
  Rss,
  Scale,
  Search,
  ShieldAlert,
  WifiOff,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Category } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HealthPill } from "@/components/dashboard/health-pill";
import { useDashboardStore } from "@/lib/store";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
  onSelect: () => void;
}

export function TopBar({
  referenceTime,
  liteMode,
  demo,
}: {
  referenceTime: string;
  liteMode: boolean;
  demo: boolean;
}) {
  const setSearchOpen = useDashboardStore((state) => state.setSearchOpen);
  const setRegionalOpen = useDashboardStore((state) => state.setRegionalOpen);
  const setDirectoryOpen = useDashboardStore((state) => state.setDirectoryOpen);
  const setMethodologyOpen = useDashboardStore(
    (state) => state.setMethodologyOpen,
  );
  const setLiteMode = useDashboardStore((state) => state.setLiteMode);
  const setEconomyOpen = useDashboardStore((state) => state.setEconomyOpen);
  const setHistoryOpen = useDashboardStore((state) => state.setHistoryOpen);
  const setSourcesOpen = useDashboardStore((state) => state.setSourcesOpen);
  const setFilter = useDashboardStore((state) => state.setFilter);
  const activeCategory = useDashboardStore((state) => state.filters.category);

  const categoryItem = (
    id: Category | "all",
    label: string,
    icon: LucideIcon,
  ): NavItem => ({
    key: id,
    label,
    icon,
    current: activeCategory === id,
    onSelect: () => setFilter("category", id),
  });
  const items: NavItem[] = [
    categoryItem("all", "Overview", LayoutGrid),
    categoryItem("security", "Security", ShieldAlert),
    categoryItem("politics", "Politics", Scale),
    categoryItem("infrastructure", "Infrastructure", Building2),
    {
      key: "economy",
      label: "Economy",
      icon: Landmark,
      onSelect: () => setEconomyOpen(true),
    },
    {
      key: "regions",
      label: "Regions",
      icon: MapPinned,
      onSelect: () => setRegionalOpen(true),
    },
    {
      key: "history",
      label: "History",
      icon: History,
      onSelect: () => setHistoryOpen(true),
    },
    {
      key: "sources",
      label: "Sources",
      icon: Rss,
      onSelect: () => setSourcesOpen(true),
    },
    {
      key: "states",
      label: "States",
      icon: Compass,
      onSelect: () => setDirectoryOpen(true),
    },
    {
      key: "notes",
      label: "Data notes",
      icon: Info,
      onSelect: () => setMethodologyOpen(true),
    },
  ];
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas/95 px-2.5 sm:px-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md border border-info/30 bg-[radial-gradient(circle_at_30%_25%,#164e63,#081420_70%)] text-info shadow-[0_0_18px_rgba(53,189,242,0.16)]"
          aria-hidden
        >
          <Compass className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 leading-none">
          <p className="truncate text-[12.5px] font-semibold tracking-[0.06em] text-ink">
            NIGERIA STATE MONITOR
          </p>
          <p className="mt-1 hidden font-mono text-[8.5px] uppercase tracking-[0.18em] text-faint sm:block">
            National intelligence · Geospatial · Economic
          </p>
        </div>
        {demo ? (
          <span className="ml-1 hidden rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-warning md:inline">
            Demo
          </span>
        ) : null}
      </div>

      <nav
        className="ml-3 hidden items-center gap-0.5 xl:flex"
        aria-label="Primary"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.key}
              variant={item.current ? "secondary" : "ghost"}
              size="sm"
              aria-current={item.current ? "page" : undefined}
              onClick={item.onSelect}
              className={cn(
                item.current &&
                  "border-info/25 bg-info/10 text-info hover:bg-info/10",
              )}
            >
              <Icon aria-hidden />
              {item.label}
            </Button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="mr-1 hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint 2xl:flex">
          <span className="text-faint/70">Ref</span>
          {formatDateTime(referenceTime)}
        </span>

        <HealthPill liteMode={liteMode} />

        <label
          className={cn(
            "flex h-7 cursor-pointer items-center gap-1.5 rounded border border-line bg-panel-2 px-1.5 transition-colors hover:border-line-2 sm:px-2",
            liteMode && "border-positive/35 bg-positive/10",
          )}
          title="Reduce data transfer: inline SVG map, no MapLibre, no chart animation"
        >
          {liteMode ? (
            <WifiOff className="size-3 text-positive" aria-hidden />
          ) : (
            <Wifi className="size-3 text-faint" aria-hidden />
          )}
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.08em] text-muted sm:inline">
            Lite
          </span>
          <Switch
            checked={liteMode}
            onCheckedChange={(checked) => setLiteMode(checked)}
            aria-label="Low-bandwidth lite mode"
          />
        </label>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSearchOpen(true)}
          aria-keyshortcuts="Control+K Meta+K"
          className="w-8 justify-center px-0 sm:w-auto sm:justify-start sm:px-2.5"
        >
          <Search aria-hidden />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-1 hidden rounded border border-line-2 bg-canvas-2 px-1 font-mono text-[8px] text-faint lg:inline">
            ⌘K
          </kbd>
        </Button>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Open navigation menu"
              className="xl:hidden"
            >
              <Menu aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1" align="end">
            <nav aria-label="Sections" className="flex flex-col">
              {items
                .filter((item) => item.key !== "notes")
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-current={item.current ? "page" : undefined}
                      onClick={() => {
                        setMenuOpen(false);
                        item.onSelect();
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-muted hover:bg-panel-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-info",
                        item.current && "bg-info/10 text-info",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {item.label}
                    </button>
                  );
                })}
            </nav>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => setMethodologyOpen(true)}
          aria-label="Open data notes and methodology"
          className="xl:hidden"
        >
          <Info aria-hidden />
        </Button>
      </div>
    </header>
  );
}
