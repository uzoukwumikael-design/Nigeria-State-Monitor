"use client";

import {
  BadgeCheck,
  CalendarClock,
  Clock3,
  ExternalLink,
  MapPin,
  Radio,
  ShieldQuestion,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import {
  SOURCE_TIER_LABELS,
  VERIFICATION_CONFIG,
  categoryConfig,
  zoneConfig,
  withAlpha,
} from "@/lib/config";
import {
  formatCoordinates,
  formatDateTime,
  formatNumber,
  formatPercent,
  relativeTime,
} from "@/lib/format";
import { useDashboardStore } from "@/lib/store";
import type {
  EventTimelineEntry,
  GeoPrecision,
  IntelligenceEvent,
  SourceRelationship,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const PRECISION_LABEL: Record<GeoPrecision, string> = {
  exact: "Exact location",
  lga: "LGA representative point",
  state: "State representative point",
  national: "National scope · not plotted",
  unknown: "Location unknown · not plotted",
};

const PRECISION_NOTE: Record<GeoPrecision, string> = {
  exact: "The record includes a specific coordinate.",
  lga: "The marker is the representative point of the LGA, not a confirmed incident location.",
  state:
    "Only a state-level location is available; the marker is a representative state point.",
  national:
    "This record has no state-level location and is not plotted as a map point.",
  unknown: "No reliable location is available. No map point is shown.",
};

const RELATIONSHIP_LABEL: Record<
  SourceRelationship,
  { label: string; color: string }
> = {
  primary: { label: "Primary", color: "#35BDF2" },
  supporting: { label: "Supporting", color: "#8492A8" },
  conflicting: { label: "Conflicting", color: "#FFB020" },
  retracted: { label: "Retracted", color: "#FF4757" },
  background: { label: "Background", color: "#64748B" },
};

const TIMELINE_LABEL: Record<EventTimelineEntry["type"], string> = {
  new_report: "New report",
  casualty_update: "Casualty update",
  official_statement: "Official statement",
  correction: "Correction",
  retraction: "Retraction",
  location_update: "Location update",
  verification_change: "Verification change",
  context: "Context",
};

function Meta({
  label,
  value,
  mono,
  note,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  note?: string;
}) {
  return (
    <div className="min-w-0 rounded border border-line/70 bg-canvas-2/60 px-2 py-1.5">
      <p className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-faint">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-[10.5px] text-ink",
          mono && "font-mono text-[9.5px]",
        )}
      >
        {value}
      </p>
      {note ? (
        <p className="mt-0.5 text-[8px] leading-snug text-faint">{note}</p>
      ) : null}
    </div>
  );
}

/** Confidence is only meaningful when it was actually assessed; production records start unassessed at 0. */
function confidenceNote(isDemo: boolean, value: number): string {
  if (isDemo) return `Demo confidence ${formatPercent(value)}`;
  return value > 0
    ? `Confidence ${formatPercent(value)}`
    : "Confidence not assessed";
}

export function EventDialog({
  event,
  events,
  referenceTime,
  onClose,
}: {
  event: IntelligenceEvent | null;
  events: IntelligenceEvent[];
  referenceTime: string;
  onClose: () => void;
}) {
  const selectEvent = useDashboardStore((state) => state.selectEvent);
  const selectState = useDashboardStore((state) => state.selectState);
  const setMobileView = useDashboardStore((state) => state.setMobileView);

  if (!event) return null;

  const category = categoryConfig(event.category);
  const verification = VERIFICATION_CONFIG[event.verificationStatus];
  const related = event.relatedEventIds
    .map((id) => events.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is IntelligenceEvent => Boolean(candidate));
  const timeline = [...event.timeline].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const zone = event.zone ? zoneConfig(event.zone) : null;
  const location =
    [event.stateName, event.lga].filter(Boolean).join(" · ") ||
    "National scope";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-4xl overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5 pr-8">
            <span
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em]"
              style={{
                borderColor: withAlpha(category.color, 0.35),
                color: category.color,
              }}
            >
              <CategoryIcon category={event.category} className="size-2.5" />
              {category.shortLabel}
            </span>
            {event.isDemo ? <Badge variant="demo">Demo event</Badge> : null}
            <span
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em]"
              style={{
                borderColor: withAlpha(verification.color, 0.32),
                color: verification.color,
              }}
              title={verification.description}
            >
              <ShieldQuestion className="size-2.5" aria-hidden />
              {verification.label}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.06em] text-faint">
              <Radio className="size-2.5" aria-hidden />
              {event.independentSourceCount} independent · {event.articleCount}{" "}
              reports
            </span>
          </div>

          <DialogTitle className="mt-2 text-balance pr-6 text-[18px] font-semibold leading-snug text-ink">
            {event.title}
          </DialogTitle>
          <DialogDescription className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted">
            {event.summary}
          </DialogDescription>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[8px] uppercase tracking-[0.06em] text-faint">
            <span className="inline-flex items-center gap-1 text-muted">
              <MapPin className="size-2.5" aria-hidden /> {location}
            </span>
            <span className="text-line-2">·</span>
            <span>{zone ? zone.name : "National"}</span>
            <span className="text-line-2">·</span>
            <span>{PRECISION_LABEL[event.geoPrecision]}</span>
            <span className="text-line-2">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-2.5" aria-hidden /> updated{" "}
              {relativeTime(event.lastUpdatedAt, referenceTime)}
            </span>
            {event.isDemo ? (
              <>
                <span className="text-line-2">·</span>
                <span className="text-warning/80">Fictional demo record</span>
              </>
            ) : null}
          </div>
        </div>

        <Tabs
          key={event.id}
          defaultValue="overview"
          className="flex min-h-0 flex-col"
        >
          <div className="border-b border-line px-4 py-2">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="sources">
                Sources{" "}
                <span className="ml-1 text-faint">{event.sources.length}</span>
              </TabsTrigger>
              <TabsTrigger value="timeline">
                Timeline{" "}
                <span className="ml-1 text-faint">{timeline.length}</span>
              </TabsTrigger>
              <TabsTrigger value="analysis">Analysis & uncertainty</TabsTrigger>
            </TabsList>
          </div>

          <div className="nsm-scroll max-h-[64dvh] overflow-y-auto p-4">
            <TabsContent value="overview" className="space-y-3">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <Meta
                  label="Reported severity"
                  value={`${event.severity} · ${["Info", "Low", "Moderate", "High", "Critical"][event.severity - 1]}`}
                  note="Reported impact, not measured risk"
                />
                <Meta
                  label="Verification"
                  value={verification.label}
                  note={confidenceNote(event.isDemo, event.confidence)}
                />
                <Meta
                  label="Evidence"
                  value={`${event.independentSourceCount} independent`}
                  note={`${event.articleCount} article copies`}
                />
                <Meta
                  label="Geographic precision"
                  value={PRECISION_LABEL[event.geoPrecision]}
                  note={confidenceNote(event.isDemo, event.geoConfidence)}
                  mono
                />
                <Meta
                  label="Coordinates"
                  value={formatCoordinates(event.coordinates)}
                  note={
                    event.coordinates
                      ? "Representative point, not a confirmed incident location"
                      : "No map point for this record"
                  }
                  mono
                />
                <Meta label="Record" value={event.id} note={event.slug} mono />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <section className="rounded-md border border-line bg-canvas-2/40 px-3 py-2">
                  <h3 className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-faint">
                    <MapPin className="size-2.5" aria-hidden /> Location &
                    precision
                  </h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">
                    {event.stateName ?? "National scope"}
                    {event.lga ? ` · ${event.lga}` : ""}.{" "}
                    {PRECISION_NOTE[event.geoPrecision]}
                  </p>
                  {event.coordinates ? (
                    <p className="mt-1 font-mono text-[9px] text-faint">
                      {formatCoordinates(event.coordinates)}
                    </p>
                  ) : null}
                </section>

                <section className="rounded-md border border-line bg-canvas-2/40 px-3 py-2">
                  <h3 className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-faint">
                    <CalendarClock className="size-2.5" aria-hidden /> Timing
                  </h3>
                  <dl className="mt-1 space-y-0.5 text-[9.5px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-faint">Occurrence</dt>
                      <dd className="text-right text-muted">
                        {formatDateTime(event.occurrenceAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-faint">First report</dt>
                      <dd className="text-right text-muted">
                        {formatDateTime(event.firstReportedAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-faint">Last update</dt>
                      <dd className="text-right text-muted">
                        {formatDateTime(event.lastUpdatedAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-faint">Reference</dt>
                      <dd className="text-right text-muted">
                        {formatDateTime(referenceTime)}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>

              <section className="rounded-md border border-line bg-canvas-2/40 px-3 py-2">
                <h3 className="font-mono text-[8px] uppercase tracking-[0.1em] text-faint">
                  Severity rationale
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  {event.severityRationale}
                </p>
              </section>

              {event.stateId ? (
                <button
                  type="button"
                  onClick={() => {
                    selectState(event.stateId);
                    setMobileView("brief");
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-info/30 bg-info/10 px-2.5 py-1.5 text-[10px] text-info transition-colors hover:bg-info/15 focus-visible:outline-2 focus-visible:outline-info"
                >
                  <MapPin className="size-3" aria-hidden />
                  Open {event.stateName} state brief
                </button>
              ) : null}
            </TabsContent>

            <TabsContent value="sources" className="space-y-2">
              <div className="rounded border border-info/25 bg-info/[0.06] px-3 py-2 text-[9.5px] leading-relaxed text-info/85">
                {event.isDemo ? "These are fictional demo sources. " : ""}
                {event.articleCount} article copies belong to{" "}
                {event.independentSourceCount} independent source groups; the
                article count is not a count of incidents or independent
                confirmations.
                {event.isDemo
                  ? " No external URLs are provided for demo records."
                  : " Repeated reports from one publisher are not independent corroboration."}
              </div>
              {event.sources.map((source, index) => {
                const relationship = RELATIONSHIP_LABEL[source.relationship];
                return (
                  <article
                    key={source.id}
                    className="rounded-md border border-line bg-canvas-2/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="grid size-4 place-items-center rounded-full border border-line bg-panel-2 font-mono text-[7.5px] text-faint">
                        {index + 1}
                      </span>
                      <span className="text-[10.5px] font-medium text-ink">
                        {source.sourceName}
                      </span>
                      <span
                        className="rounded border px-1 py-px font-mono text-[7px] uppercase tracking-[0.06em]"
                        style={{
                          borderColor: withAlpha(relationship.color, 0.3),
                          color: relationship.color,
                        }}
                      >
                        {relationship.label}
                      </span>
                      {event.isDemo ? (
                        <Badge variant="muted" className="px-1 py-0 text-[7px]">
                          Demo source
                        </Badge>
                      ) : null}
                      <span className="ml-auto font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
                        {SOURCE_TIER_LABELS[source.sourceTier]} ·{" "}
                        {source.sourceType}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-snug text-muted">
                      {source.headline}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
                      <span>
                        Independence group:{" "}
                        <span className="text-muted">
                          {source.independenceGroup}
                        </span>
                      </span>
                      <span className="text-line-2">·</span>
                      <span>
                        Published:{" "}
                        <span className="text-muted">
                          {formatDateTime(source.publishedAt)}
                        </span>
                      </span>
                      <span className="text-line-2">·</span>
                      <span>
                        Retrieved:{" "}
                        <span className="text-muted">
                          {formatDateTime(source.retrievedAt)}
                        </span>
                      </span>
                    </div>
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex items-center gap-1 text-[9px] text-info hover:underline"
                      >
                        <ExternalLink className="size-2.5" aria-hidden />{" "}
                        Original report
                      </a>
                    ) : (
                      <p className="mt-1 inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint/80">
                        <ExternalLink className="size-2.5" aria-hidden />{" "}
                        {event.isDemo
                          ? "No external link — fictional demo source"
                          : "No external link recorded"}
                      </p>
                    )}
                  </article>
                );
              })}
            </TabsContent>

            <TabsContent value="timeline" className="space-y-0">
              <ol className="relative ml-1 border-l border-line pl-4">
                {timeline.map((entry) => (
                  <li key={entry.id} className="relative pb-3 last:pb-0">
                    <span
                      className="absolute -left-[21px] top-1 size-2 rounded-full border border-canvas bg-info/70"
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-info">
                        {TIMELINE_LABEL[entry.type]}
                      </span>
                      <span className="font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
                        {entry.actor}
                      </span>
                      <span className="ml-auto font-mono text-[7.5px] text-faint">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                      {entry.description}
                    </p>
                    {entry.sourceName ? (
                      <p className="mt-0.5 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
                        {entry.sourceName}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </TabsContent>

            <TabsContent value="analysis" className="space-y-2.5">
              <section className="rounded-md border border-info/25 bg-info/[0.05] px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3 text-info" aria-hidden />
                  <h3 className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-info">
                    {event.isDemo
                      ? "Automated demo summary"
                      : "Automated summary"}
                  </h3>
                  <Badge variant="info" className="ml-auto">
                    Rule-based · not AI
                  </Badge>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                  {event.analysis}
                </p>
                <p className="mt-1.5 border-t border-info/15 pt-1.5 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
                  Analysis is separate from reported facts · no operational
                  conclusion
                </p>
              </section>

              <section className="rounded-md border border-warning/25 bg-warning/[0.05] px-3 py-2">
                <h3 className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-warning">
                  <TriangleAlert className="size-3" aria-hidden /> Uncertainties
                </h3>
                {event.uncertainties.length === 0 ? (
                  <p className="mt-1 text-[10px] text-muted">
                    No additional uncertainty notes.
                  </p>
                ) : (
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed text-warning/85">
                    {event.uncertainties.map((uncertainty) => (
                      <li key={uncertainty}>{uncertainty}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                  Related {event.isDemo ? "demo " : ""}events
                </h3>
                {related.length === 0 ? (
                  <p className="text-[10px] text-faint">
                    No related {event.isDemo ? "demo " : ""}events share this
                    category and state.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {related.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => selectEvent(candidate.id)}
                        className="flex w-full items-center gap-2 rounded border border-line bg-canvas-2/40 px-2.5 py-1.5 text-left transition-colors hover:border-line-2 hover:bg-panel-2/60 focus-visible:outline-2 focus-visible:outline-info"
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: categoryConfig(candidate.category)
                              .color,
                          }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
                          {candidate.title}
                        </span>
                        <span className="shrink-0 font-mono text-[8px] text-faint">
                          S{candidate.severity} ·{" "}
                          {relativeTime(candidate.lastUpdatedAt, referenceTime)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-warning/[0.05] px-4 py-1.5">
          <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden />
          <p className="font-mono text-[7.5px] uppercase tracking-[0.06em] text-warning/85">
            {event.isDemo
              ? "DEMO DATA — NOT A REAL INCIDENT · fictional record for interface demonstration"
              : "Source reports are linked on the Sources tab · verification status as shown · AI analysis is kept separate from reported facts"}
          </p>
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.05em] text-faint">
            <BadgeCheck className="size-2.5" aria-hidden />
            {formatNumber(event.articleCount)} reports ·{" "}
            {formatNumber(event.independentSourceCount)} groups
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
