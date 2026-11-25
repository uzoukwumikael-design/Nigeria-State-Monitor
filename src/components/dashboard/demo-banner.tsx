"use client";

import { Info, ShieldAlert } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import { formatDateTime } from "@/lib/format";

export function DemoBanner({
  disclaimer,
  generatedAt,
  mode,
}: {
  disclaimer: string | null;
  generatedAt: string;
  mode: "demo" | "production";
}) {
  const setMethodologyOpen = useDashboardStore(
    (state) => state.setMethodologyOpen,
  );
  if (mode !== "demo") return null;

  return (
    <div className="demo-stripes relative flex min-h-[30px] shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/[0.045] px-2.5 py-1 sm:px-3.5">
      <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 truncate text-[10.5px] font-medium leading-tight text-warning sm:text-[11px]">
        <span className="font-mono tracking-[0.08em]">
          {disclaimer ?? "DEMO DATA — NOT A REAL INCIDENT"}
        </span>
        <span className="ml-2 hidden text-warning/70 md:inline">
          Static fictional dataset · no live dashboard feed, AI enrichment or
          realtime · generated {formatDateTime(generatedAt)}
        </span>
      </p>
      <button
        type="button"
        onClick={() => setMethodologyOpen(true)}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-warning/30 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-warning/90 transition-colors hover:bg-warning/10 focus-visible:outline-2 focus-visible:outline-warning"
      >
        <Info className="size-3" aria-hidden />
        <span className="hidden sm:inline">What this means</span>
        <span className="sm:hidden">Info</span>
      </button>
    </div>
  );
}
