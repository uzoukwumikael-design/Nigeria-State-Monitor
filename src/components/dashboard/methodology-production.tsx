"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-info">{title}</h3>
      <div className="space-y-1.5 text-[11px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** Data notes for real (non-demo) data. Kept short and factual; the demo snapshot has its own longer version. */
export function ProductionMethodology({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden p-0" aria-describedby="methodology-description">
        <div className="border-b border-line bg-panel-2/40 px-4 py-3">
          <DialogTitle className="text-[15px]">Data notes &amp; methodology</DialogTitle>
          <DialogDescription id="methodology-description" className="mt-1 text-[10.5px]">
            What this dashboard shows, where it comes from and how to read it.
          </DialogDescription>
        </div>
        <div className="nsm-scroll max-h-[70dvh] space-y-4 overflow-y-auto p-4">
          <Section title="What this is">
            <p>
              A situational-awareness view of events reported in Nigerian news, by state and geopolitical zone. It is built from published
              reports and is not an official record of incidents.
            </p>
          </Section>
          <Section title="Where the data comes from">
            <p>
              Events come from the news sources listed on the Sources tab (publisher feeds and a headline index). Records are created and
              classified by software: the state and category are read from the headline and excerpt, and shown at state level, so a marker
              is a representative point for the state, not the place of the incident. Each event links to the outlets that reported it;
              the articles belong to those outlets, and only their headlines are shown.
            </p>
            <p>
              Economic indicators are national annual series from the World Bank World Development Indicators (CC BY 4.0), each with its
              own reference year. They are separate from the event counts.
            </p>
          </Section>
          <Section title="How to read it">
            <ul className="list-inside list-disc space-y-1">
              <li>Counts are reported volume, not incidence, danger or a safety ranking of any state.</li>
              <li>Severity reflects the impact described in the report. It is assigned by software and does not go above level 3.</li>
              <li>
                “Independent sources” counts separate outlets. Several reports from one outlet count once, and many copies of the same
                story are not confirmation.
              </li>
              <li>Verification status is shown per event. Most events are unassessed or single-source.</li>
              <li>AI-written analysis, where shown, is kept separate from what the reports say.</li>
            </ul>
          </Section>
          <Section title="Limits">
            <ul className="list-inside list-disc space-y-1">
              <li>Coverage is limited to the registered sources and is not a complete record. Some states have little coverage.</li>
              <li>History begins when collection began. Earlier dates and quiet-looking gaps are unobserved, not quiet.</li>
              <li>A state with no reports is unobserved, not safe.</li>
              <li>Headline-only items have less context, so their classification is less certain.</li>
              <li>Offline mode shows copies saved on your device and says so; it cannot show anything you have not opened before.</li>
            </ul>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
