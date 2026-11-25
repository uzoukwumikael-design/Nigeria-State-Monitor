"use client";

import {
  BookOpen,
  Database,
  Gauge,
  Layers,
  Map as MapIcon,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboardStore } from "@/lib/store";

import { useDatasetLabels } from "@/lib/dataset-labels";
import { ProductionMethodology } from "@/components/dashboard/methodology-production";
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 border-b border-line/50 py-1.5 last:border-b-0">
      <dt className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
        {label}
      </dt>
      <dd className="text-[10px] leading-relaxed text-muted">{children}</dd>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-canvas-2/40 px-3 py-2">
      <h3 className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
        <Icon className="size-3 text-info" aria-hidden />
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

export function MethodologyDialog() {
  const open = useDashboardStore((state) => state.methodologyOpen);
  const setOpen = useDashboardStore((state) => state.setMethodologyOpen);
  const L = useDatasetLabels();

  // Real data gets its own accurate notes; the demo snapshot keeps the detailed demo document below.
  if (!L.isDemo) return <ProductionMethodology open={open} onOpenChange={setOpen} />;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-3xl overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <BookOpen className="size-4 text-info" aria-hidden />
            Data notes & methodology
          </DialogTitle>
          <DialogDescription className="mt-1 text-[10.5px]">
            What this build does, what it does not do, and how to read the map,
            counts, regional comparisons and evidence fields. The dashboard is a
            fictional demo snapshot. A Postgres/PostGIS repository and one RSS
            capture path exist behind the scenes, but no live dashboard feed, AI
            enrichment or realtime channel is connected.
          </DialogDescription>
        </div>

        <Tabs defaultValue="status" className="flex min-h-0 flex-col">
          <div className="border-b border-line px-4 py-2">
            <TabsList>
              <TabsTrigger value="status">Status</TabsTrigger>
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="limits">Limitations</TabsTrigger>
            </TabsList>
          </div>

          <div className="nsm-scroll max-h-[60dvh] overflow-y-auto p-4">
            <TabsContent value="status" className="space-y-2.5">
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2">
                <ShieldAlert
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden
                />
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-warning">
                    DEMO DATA — NOT A REAL INCIDENT
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-warning/85">
                    Every event, source, headline and count on this dashboard is
                    fictional and static. Reference time is fixed at 02 Nov 2026
                    10:00 WAT. Nothing in this interface represents a real
                    incident, a live feed or a verified source.
                  </p>
                </div>
              </div>

              <Section icon={ShieldCheck} title="Implemented in Phases 2–5">
                <dl>
                  <Row label="Dashboard">
                    National and state views, intelligence wire, KPI strip,
                    bottom analytics, deep links and mobile tabs.
                  </Row>
                  <Row label="Regions">
                    Six geopolitical zones with a like-for-like comparison,
                    selectable zone profiles, 7/14/30-day trends and zone-level
                    category, severity, verification, coverage and source
                    panels.
                  </Row>
                  <Row label="Map">
                    Authoritative GRID3 ADM1 boundaries for 37 first-order
                    units, hover tooltips, click-to-filter, state directory,
                    event markers and clusters.
                  </Row>
                  <Row label="Data foundation">
                    Nine checksummed Postgres/PostGIS migrations, guarded demo
                    and registry seeds, a SQL repository, public read views,
                    review-queue RLS and an append-only reviewer audit, verified
                    locally with PGlite + PostGIS.
                  </Row>
                  <Row label="Capture">
                    One restricted RSS source (Premium Times) fetched by CLI
                    into a review queue, with deterministic category and
                    state/LGA priors. Captured items are evidence, not events.
                  </Row>
                  <Row label="Review">
                    A server-side CLI accepts or rejects candidates with a
                    stable reviewer ID and an append-only audit row. Acceptance
                    is not verification or publication.
                  </Row>
                  <Row label="Demo data">
                    74 fictional event records, 8 fictional demo sources,
                    evidence status, timelines, uncertainties and per-event
                    analysis labels.
                  </Row>
                  <Row label="API">
                    Events, event detail, states, state detail, national,
                    regional, trends, search, sources, history, economy
                    indicators and system health. Economy figures are fetched
                    live from the World Bank and are never mixed with demo event
                    counts.
                  </Row>
                  <Row label="Low bandwidth">
                    Lite mode swaps MapLibre for an inline SVG map and Recharts
                    for CSS bars. It also honours the browser Save-Data hint.
                  </Row>
                </dl>
              </Section>

              <Section icon={Layers} title="Regional intelligence">
                <p className="text-[10px] leading-relaxed text-muted">
                  The six-zone comparison keeps all zones on the same filter
                  basis so their counts stay comparable. Dashboard state
                  selection is excluded from regional queries, and
                  national-scope records without a state assignment are omitted
                  from zone comparisons. The comparison metric can be switched
                  between reported volume, severity 4–5 share,
                  corroborated-or-officially-confirmed share and state coverage.
                </p>
                <p className="mt-1.5 text-[9px] leading-relaxed text-faint">
                  Zone ordering and every comparison label describe reported
                  demo volume or composition. They are not a risk score, danger
                  ranking or safety assessment. Zone profiles and trend ranges
                  are deep-linkable: open a state brief and choose &ldquo;Open
                  zone profile&rdquo;, or use{" "}
                  <span className="break-all font-mono text-ink">
                    ?view=regions&amp;region=south-west&amp;trend=14
                  </span>
                  .
                </p>
              </Section>

              <Section icon={Database} title="Not connected (not simulated)">
                <ul className="list-inside list-disc space-y-0.5 text-[10px] leading-relaxed text-muted">
                  <li>Live dashboard feed from captured articles</li>
                  <li>Scheduled ingestion, per-source locking or retry jobs</li>
                  <li>Reviewer UI/authentication and event publication</li>
                  <li>AI enrichment, summarisation or event merging</li>
                  <li>Realtime updates, alerts or notifications</li>
                  <li>Economy indicators and historical intelligence</li>
                  <li>Authentication, user accounts and saved views</li>
                </ul>
                <p className="mt-1.5 text-[9px] leading-relaxed text-faint">
                  The capture CLI writes review candidates only; the reviewer
                  CLI records accept/reject decisions with an append-only audit.
                  Neither publishes an event. No update, timestamp or health
                  signal is fabricated; when an upstream source is unreachable
                  the API says so instead of returning invented values.
                </p>
              </Section>

              <Section icon={Gauge} title="Keyboard & navigation">
                <p className="text-[10px] leading-relaxed text-muted">
                  <kbd className="rounded border border-line bg-panel-2 px-1 font-mono text-[8px]">
                    Ctrl
                  </kbd>{" "}
                  /{" "}
                  <kbd className="rounded border border-line bg-panel-2 px-1 font-mono text-[8px]">
                    ⌘
                  </kbd>{" "}
                  +{" "}
                  <kbd className="rounded border border-line bg-panel-2 px-1 font-mono text-[8px]">
                    K
                  </kbd>{" "}
                  or <span className="font-mono text-ink">/</span> opens search.
                  Use Tab to reach controls, arrow keys to move through search
                  results and Enter to open. In lite mode each state is a
                  focusable SVG path; Escape clears the state selection. All
                  filters are encoded in the URL, so any view can be shared or
                  bookmarked. The regional dialog adds{" "}
                  <span className="font-mono text-ink">view=regions</span>,{" "}
                  <span className="font-mono text-ink">region</span> and{" "}
                  <span className="font-mono text-ink">trend</span> parameters
                  while it is open.
                </p>
              </Section>
            </TabsContent>

            <TabsContent value="map" className="space-y-2.5">
              <Section icon={MapIcon} title="Boundaries">
                <p className="text-[10px] leading-relaxed text-muted">
                  Nigeria&apos;s 36 states and the Federal Capital Territory are
                  drawn from the GRID3 ADM1 release (2022), distributed by
                  geoBoundaries and licensed CC BY 4.0. The geometry is checked
                  in, validated against the 37-entry state registry, and served
                  locally. No external tile service, map font or CDN is used.
                  Total calculated area is 916,462.5 km² from the source
                  polygons.
                </p>
                <p className="mt-1.5 text-[9px] leading-relaxed text-faint">
                  Boundaries are administrative reference geometry, not a
                  political claim. The standard map loads 221 kB of local
                  GeoJSON plus the MapLibre runtime; the lite map loads a
                  generated 151 kB SVG path set and no MapLibre.
                </p>
              </Section>

              <Section icon={Layers} title="Choropleth and markers">
                <p className="text-[10px] leading-relaxed text-muted">
                  State shading uses a neutral blue ramp for reported-event
                  volume. It is deliberately not a red/green danger scale. Event
                  markers are coloured by category and sized by reported
                  severity; clusters group nearby events at low zoom. Marker
                  positions come from LGA representative points or state label
                  points, and are explicitly labelled as approximate.
                  National-scope records are never plotted as a point.
                </p>
              </Section>

              <Section icon={Gauge} title="Low-bandwidth mode">
                <p className="text-[10px] leading-relaxed text-muted">
                  Lite mode avoids MapLibre, WebGL, tile requests and chart
                  animation. It keeps all 37 units selectable, identical filters
                  and the same event feed. The preference is remembered locally.
                  Standard mode is loaded only when needed with a dynamic
                  import.
                </p>
              </Section>
            </TabsContent>

            <TabsContent value="evidence" className="space-y-2.5">
              <Section icon={ShieldCheck} title="One event, many reports">
                <p className="text-[10px] leading-relaxed text-muted">
                  An event record groups reports about the same reported
                  development. Article count is not a count of incidents.
                  Independent source count is based on declared independence
                  groups, so syndicated copies from one publisher do not count
                  as corroboration. Demo sources are clearly marked and have no
                  external URLs.
                </p>
              </Section>

              <Section icon={Database} title="Verification and confidence">
                <p className="text-[10px] leading-relaxed text-muted">
                  Verification status ranges from unassessed through single
                  source, multiple sources, corroborated and official
                  confirmation to disputed and retracted. The confidence value
                  is a demo record attribute, not a statistical probability.
                  Disputed and retracted records remain visible with their
                  status.
                </p>
              </Section>

              <Section
                icon={ShieldAlert}
                title="Facts, analysis and uncertainty"
              >
                <p className="text-[10px] leading-relaxed text-muted">
                  Reported facts, automated summary text and uncertainties are
                  shown separately. Every analysis block is labelled “automated
                  demo summary” and is rule-based; it is not AI analysis.
                  Severity is a reported-impact field, not a measured risk
                  score. Reported volume is never converted into a safety
                  ranking.
                </p>
              </Section>

              <Section icon={Gauge} title="What the numbers mean">
                <p className="text-[10px] leading-relaxed text-muted">
                  Counts are reported-event volume under the active filters.
                  Time windows use occurrence time where available, otherwise
                  first report time. A state with zero reported demo events is
                  not shown as safe; it simply has no demo record in view. The
                  dataset has no historical completeness and should not be used
                  for operational decisions.
                </p>
              </Section>
            </TabsContent>

            <TabsContent value="limits" className="space-y-2.5">
              <Section icon={ShieldAlert} title="Known limitations">
                <ul className="list-inside list-disc space-y-1 text-[10px] leading-relaxed text-muted">
                  <li>
                    All 74 events and 8 dashboard sources are fictional and
                    static.
                  </li>
                  <li>
                    Captured articles stay in the review queue; the dashboard
                    does not publish them.
                  </li>
                  <li>
                    The review, clustering, verification and publication tooling
                    exists in code but has not been run against a hosted
                    database. There is no realtime channel.
                  </li>
                  <li>
                    No authentication or multi-user persistence; views live in
                    the URL.
                  </li>
                  <li>
                    History only covers the records held (the demo snapshot
                    here); dates outside them are unobserved, not quiet.
                    Economic indicators are national annual series; no state or
                    zone level economic data is integrated.
                  </li>
                  <li>
                    Offline mode serves saved copies of pages and data, clearly
                    labelled; it cannot show anything you have not opened
                    before.
                  </li>
                  <li>
                    LGA-level markers use representative points, not incident
                    coordinates.
                  </li>
                  <li>
                    Regional comparisons exclude national-scope records and only
                    describe the active filters; zero records means unobserved,
                    not safe.
                  </li>
                  <li>
                    Postgres/PostGIS is verified locally with PGlite; no hosted
                    database is provisioned.
                  </li>
                  <li>
                    The MapLibre path requires WebGL; lite mode is the fallback.
                  </li>
                </ul>
              </Section>

              <Section icon={BookOpen} title="Source & licence">
                <p className="text-[10px] leading-relaxed text-muted">
                  Administrative boundaries: GRID3 via geoBoundaries, ADM1 2022,
                  CC BY 4.0. Event and source content: fictional demo dataset
                  authored for this project. Interface fonts (Inter, JetBrains
                  Mono) are bundled locally under their open-font licences. See{" "}
                  <span className="font-mono text-ink">
                    docs/DATA_SOURCES.md
                  </span>{" "}
                  for the full source register and verification notes.
                </p>
              </Section>

              <p className="rounded border border-line bg-canvas-2/40 px-3 py-2 text-[9px] leading-relaxed text-faint">
                The production repository, RSS capture, review console,
                clustering, verification and publication tooling exist in code.
                Until a hosted database, reviewer access and a real ingestion
                run are in place, event data on this dashboard is a fictional
                demonstration, not a live national monitoring service. Economic
                indicators are the exception: they come from the World Bank and
                are labelled with their reference year and status.
              </p>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
