import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DatasetLabelsProvider,
  datasetLabels,
  eventCount,
  useDatasetLabels,
  type DatasetLabels,
} from "@/lib/dataset-labels";

const textFields = (labels: DatasetLabels) =>
  Object.entries(labels).filter(([, value]) => typeof value === "string" && value !== labels.mode) as Array<[string, string]>;

describe("dataset labels", () => {
  it("never describes real published records as demo or fictional", () => {
    const production = datasetLabels("production");
    expect(production.isDemo).toBe(false);
    for (const [key, value] of textFields(production)) {
      expect(value, `production label "${key}"`).not.toMatch(/demo|fictional/i);
    }
  });

  it("keeps the demo wording that the demo snapshot and its tests rely on", () => {
    const demo = datasetLabels("demo");
    expect(demo.isDemo).toBe(true);
    expect(demo.events).toBe("demo events");
    expect(demo.records).toBe("demo records");
    expect(demo.snapshot).toBe("fictional demo snapshot");
    expect(demo.summary).toBe("Rule-based demo summary");
    expect(demo.Events).toBe("Demo events");
  });

  it("counts with the right singular or plural noun in both modes", () => {
    expect(eventCount(datasetLabels("demo"), 1)).toBe("1 demo event");
    expect(eventCount(datasetLabels("demo"), 3)).toBe("3 demo events");
    expect(eventCount(datasetLabels("production"), 1)).toBe("1 event");
    expect(eventCount(datasetLabels("production"), 0)).toBe("0 events");
  });

  it("follows the provider, and falls back to demo wording only when none is mounted", () => {
    function Probe() {
      return <p>{useDatasetLabels().events}</p>;
    }
    const { unmount } = render(<Probe />);
    expect(screen.getByText("demo events")).toBeInTheDocument();
    unmount();
    render(
      <DatasetLabelsProvider mode="production">
        <Probe />
      </DatasetLabelsProvider>,
    );
    expect(screen.getByText("events")).toBeInTheDocument();
  });
});
