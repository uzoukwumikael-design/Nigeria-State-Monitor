"use client";

import { MapPin, Radio, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/tooltip";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { VERIFICATION_CONFIG, categoryConfig, withAlpha } from "@/lib/config";
import { relativeTime, truncate } from "@/lib/format";
import type { IntelligenceEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRECISION_TOOLTIP: Record<IntelligenceEvent["geoPrecision"], string> = {
  exact: "The record includes a specific coordinate.",
  lga: "The marker is the representative point of the LGA, not a confirmed incident location.",
  state:
    "Only a state-level location is available. The marker is a representative state point.",
  national:
    "National-scope record with no state-level location. It is not plotted as a point.",
  unknown: "No reliable location is available. No map point is shown.",
};

export function EventCard({
  event,
  referenceTime,
  onOpen,
}: {
  event: IntelligenceEvent;
  referenceTime: string;
  onOpen: (eventId: string) => void;
}) {
  const category = categoryConfig(event.category);
  const verification = VERIFICATION_CONFIG[event.verificationStatus];
  const time = relativeTime(event.lastUpdatedAt, referenceTime);
  const location = [event.stateName, event.lga].filter(Boolean).join(" · ");

  return (
    <article
      data-testid={`event-card-${event.id}`}
      className="group relative border-b border-line/70 transition-colors last:border-b-0 hover:bg-panel-2/45 focus-within:bg-panel-2/55"
      style={{ borderLeftColor: category.color, borderLeftWidth: 2 }}
    >
      <button
        type="button"
        onClick={() => onOpen(event.id)}
        className="absolute inset-0 z-10 cursor-pointer rounded-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-info"
        aria-label={`Open ${event.isDemo ? "demo " : ""}event: ${event.title}. ${category.shortLabel}, ${event.stateName ?? "national"}, severity ${event.severity}, ${verification.label}. ${time}.`}
      />
      <div className="pointer-events-none px-2.5 py-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded border px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em]"
            style={{
              borderColor: withAlpha(category.color, 0.32),
              color: category.color,
            }}
          >
            <CategoryIcon category={event.category} className="size-2.5" />
            {category.shortLabel}
          </span>
          {event.isDemo ? (
            <Badge variant="demo" className="px-1 py-0 text-[8px]">
              Demo
            </Badge>
          ) : null}
          <span
            className="ml-auto font-mono text-[9px] tabular text-faint"
            title={new Date(event.lastUpdatedAt).toISOString()}
          >
            {time}
          </span>
        </div>

        <h3 className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-[1.35] text-ink group-hover:text-white">
          {event.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-[10px] leading-[1.45] text-muted/85">
          {event.summary}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-faint">
          <span className="inline-flex min-w-0 items-center gap-1 text-muted/90">
            <MapPin className="size-2.5 shrink-0" aria-hidden />
            <span className="truncate">{location || "National scope"}</span>
          </span>
          <InfoTooltip label={PRECISION_TOOLTIP[event.geoPrecision]}>
            <span className="rounded border border-line/80 px-1 py-px font-mono text-[8px] uppercase tracking-[0.06em]">
              {event.geoPrecision === "lga" ? "LGA" : event.geoPrecision}
            </span>
          </InfoTooltip>
          <span
            className="inline-flex items-center gap-1 rounded border px-1 py-px font-mono text-[8px] uppercase tracking-[0.05em]"
            style={{
              borderColor: withAlpha(verification.color, 0.3),
              color: verification.color,
            }}
            title={verification.description}
          >
            <ShieldQuestion className="size-2.5" aria-hidden />
            {verification.shortLabel}
          </span>
          <span
            className="ml-auto inline-flex items-center gap-1"
            title="Independent source groups, not article copies"
          >
            <Radio className="size-2.5" aria-hidden />
            <span
              className={cn(
                "tabular",
                event.independentSourceCount >= 2 ? "text-info" : "",
              )}
            >
              {event.independentSourceCount}
            </span>
            <span className="text-faint/80">indep.</span>
            <span className="text-line-2">·</span>
            <span className="tabular">{event.articleCount}</span>
            <span className="text-faint/80">reports</span>
          </span>
        </div>
      </div>
    </article>
  );
}

export function EventCardMini({
  event,
  referenceTime,
  onOpen,
}: {
  event: IntelligenceEvent;
  referenceTime: string;
  onOpen: (eventId: string) => void;
}) {
  const category = categoryConfig(event.category);
  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      className="block w-full border-b border-line/60 px-1 py-2 text-left transition-colors last:border-b-0 hover:bg-panel-2/40 focus-visible:outline-2 focus-visible:outline-info"
    >
      <div className="flex items-center gap-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: category.color }}
          aria-hidden
        />
        <span className="truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
          {category.shortLabel}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[8.5px] text-faint">
          {relativeTime(event.lastUpdatedAt, referenceTime)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted group-hover:text-ink">
        {truncate(event.title, 110)}
      </p>
    </button>
  );
}
