import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MethodologyDialog } from "@/components/dashboard/methodology-dialog";
import { DatasetLabelsProvider } from "@/lib/dataset-labels";
import { useDashboardStore } from "@/lib/store";

afterEach(() => {
  cleanup();
  useDashboardStore.setState({ methodologyOpen: false });
});

describe("Data notes dialog", () => {
  it("describes real data without calling it demo or fictional, and states how records are made", () => {
    useDashboardStore.setState({ methodologyOpen: true });
    render(
      <DatasetLabelsProvider mode="production">
        <MethodologyDialog />
      </DatasetLabelsProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "Data notes & methodology" });
    const text = dialog.textContent ?? "";
    expect(text).not.toMatch(/demo|fictional|review queue/i);
    expect(text).toMatch(/created and\s+classified by software/i);
    expect(text).toMatch(/not incidence, danger or a safety ranking/);
    expect(text).toMatch(/World Bank/);
  });

  it("keeps the detailed demo document for the demo snapshot", () => {
    useDashboardStore.setState({ methodologyOpen: true });
    render(
      <DatasetLabelsProvider mode="demo">
        <MethodologyDialog />
      </DatasetLabelsProvider>,
    );
    const text = screen.getByRole("dialog", { name: "Data notes & methodology" }).textContent ?? "";
    expect(text).toMatch(/fictional/i);
    expect(text).toMatch(/74 fictional event records/);
  });
});
