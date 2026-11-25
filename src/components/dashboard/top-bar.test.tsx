import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "@/components/dashboard/top-bar";
import { DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { useDashboardStore } from "@/lib/store";
import { DEFAULT_FILTERS } from "@/lib/types";

function reset() {
  useDashboardStore.setState({
    filters: { ...DEFAULT_FILTERS },
    economyOpen: false,
    historyOpen: false,
    sourcesOpen: false,
    regionalOpen: false,
    directoryOpen: false,
    methodologyOpen: false,
  });
}

function renderBar() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({ ok: false, status: 503, json: async () => ({}) }) as Response,
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TopBar referenceTime={DEMO_REFERENCE_TIME} liteMode={false} demo />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  reset();
  vi.unstubAllGlobals();
});

describe("top navigation", () => {
  it("offers every section named in the product spec", () => {
    reset();
    renderBar();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const label of [
      "Overview",
      "Security",
      "Politics",
      "Infrastructure",
      "Economy",
      "Regions",
      "History",
      "States",
      "Data notes",
    ]) {
      expect(
        within(nav).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("category tabs filter the feed and show which one is active", async () => {
    const user = userEvent.setup({ delay: null });
    reset();
    renderBar();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(nav).getByRole("button", { name: "Overview" }),
    ).toHaveAttribute("aria-current", "page");

    await user.click(within(nav).getByRole("button", { name: "Security" }));
    expect(useDashboardStore.getState().filters.category).toBe("security");
    expect(
      within(nav).getByRole("button", { name: "Security" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("button", { name: "Overview" }),
    ).not.toHaveAttribute("aria-current");

    await user.click(
      within(nav).getByRole("button", { name: "Infrastructure" }),
    );
    expect(useDashboardStore.getState().filters.category).toBe(
      "infrastructure",
    );

    await user.click(within(nav).getByRole("button", { name: "Overview" }));
    expect(useDashboardStore.getState().filters.category).toBe("all");
  });

  it("opens the Economy, History, Regions and States views", async () => {
    const user = userEvent.setup({ delay: null });
    reset();
    renderBar();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Economy" }));
    await user.click(within(nav).getByRole("button", { name: "History" }));
    await user.click(within(nav).getByRole("button", { name: "Regions" }));
    await user.click(within(nav).getByRole("button", { name: "States" }));
    const state = useDashboardStore.getState();
    expect([
      state.economyOpen,
      state.historyOpen,
      state.regionalOpen,
      state.directoryOpen,
    ]).toEqual([true, true, true, true]);
  });

  it("gives small screens the same sections through a menu", async () => {
    const user = userEvent.setup({ delay: null });
    reset();
    renderBar();
    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    const menu = await screen.findByRole("navigation", { name: "Sections" });
    await user.click(within(menu).getByRole("button", { name: "History" }));
    expect(useDashboardStore.getState().historyOpen).toBe(true);
    expect(
      screen.queryByRole("navigation", { name: "Sections" }),
    ).not.toBeInTheDocument();
  });
});
