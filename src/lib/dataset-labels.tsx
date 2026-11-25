"use client";

import { createContext, useContext, type ReactNode } from "react";

export type DatasetMode = "demo" | "production";

/**
 * Interface wording that depends on whether the loaded dataset is the fictional demo snapshot or real
 * published records. Demo wording must stay exactly as before; production wording must never
 * describe real records as demo or fictional.
 */
export interface DatasetLabels {
  mode: DatasetMode;
  isDemo: boolean;
  events: string;
  Events: string;
  event: string;
  records: string;
  record: string;
  sources: string;
  snapshot: string;
  snapshotShort: string;
  dataset: string;
  fictionalRecords: string;
  referenceTime: string;
  summary: string;
  reportedVolume: string;
}

const DEMO: DatasetLabels = {
  mode: "demo",
  isDemo: true,
  events: "demo events",
  Events: "Demo events",
  event: "demo event",
  records: "demo records",
  record: "demo record",
  sources: "demo sources",
  snapshot: "fictional demo snapshot",
  snapshotShort: "demo snapshot",
  dataset: "fictional demo dataset",
  fictionalRecords: "fictional demo records",
  referenceTime: "demo reference time",
  summary: "Rule-based demo summary",
  reportedVolume: "reported demo volume",
};

const PRODUCTION: DatasetLabels = {
  mode: "production",
  isDemo: false,
  events: "events",
  Events: "Events",
  event: "event",
  records: "records",
  record: "record",
  sources: "sources",
  snapshot: "loaded set of records",
  snapshotShort: "loaded records",
  dataset: "loaded records",
  fictionalRecords: "records",
  referenceTime: "reference time",
  summary: "Rule-based summary",
  reportedVolume: "reported volume",
};

export function datasetLabels(mode: DatasetMode): DatasetLabels {
  return mode === "demo" ? DEMO : PRODUCTION;
}

/** Count with the right singular or plural noun, e.g. "1 demo event" / "3 events". */
export function eventCount(labels: DatasetLabels, count: number): string {
  return `${count} ${count === 1 ? labels.event : labels.events}`;
}

// Defaults to demo wording so isolated component tests keep their existing text; the dashboard always provides the real mode.
const DatasetLabelsContext = createContext<DatasetLabels>(DEMO);

export function DatasetLabelsProvider({ mode, children }: { mode: DatasetMode; children: ReactNode }) {
  return <DatasetLabelsContext.Provider value={datasetLabels(mode)}>{children}</DatasetLabelsContext.Provider>;
}

export function useDatasetLabels(): DatasetLabels {
  return useContext(DatasetLabelsContext);
}
