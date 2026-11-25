import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActiveFilterChips,
  WireFilters,
} from "@/components/dashboard/wire-filters";
import { useDashboardStore } from "@/lib/store";
import { STATES } from "@/lib/geo/states";
import { DEFAULT_FILTERS, type Category } from "@/lib/types";

const categoryCounts = Object.fromEntries(
  [
    "security",
    "politics",
    "economy",
    "infrastructure",
    "environment",
    "health",
  ].map((id) => [id, 10]),
) as Record<Category, number>;

function resetStore() {
  useDashboardStore.setState({
    filters: { ...DEFAULT_FILTERS },
    selectedEventId: null,
    hoveredStateId: null,
    mobileView: "map",
  });
}

afterEach(resetStore);

describe("wire filters", () => {
  it("changes the category and time window in the store", async () => {
    const user = userEvent.setup();
    resetStore();
    render(
      <WireFilters
        filters={DEFAULT_FILTERS}
        states={STATES.map((state) => ({ id: state.id, name: state.name }))}
        categoryCounts={categoryCounts}
        allCategoryCount={60}
        resultCount={74}
      />,
    );

    expect(screen.getByText("74 reported events")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Economy/ }));
    expect(useDashboardStore.getState().filters.category).toBe("economy");

    await user.click(screen.getByRole("button", { name: "24H" }));
    expect(useDashboardStore.getState().filters.window).toBe("24h");
  });

  it("shows and removes active filter chips", async () => {
    const user = userEvent.setup();
    resetStore();
    const filters = {
      ...DEFAULT_FILTERS,
      stateId: "NG-LA",
      category: "economy" as const,
      severity: 4 as const,
      q: "flood",
    };
    useDashboardStore.setState({ filters });
    render(<ActiveFilterChips filters={filters} />);

    expect(
      screen.getByRole("button", { name: "Remove filter Lagos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove filter Economy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove filter “flood”" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove filter Lagos" }),
    );
    expect(useDashboardStore.getState().filters.stateId).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Remove filter Economy" }),
    );
    expect(useDashboardStore.getState().filters.category).toBe("all");
  });

  it("renders nothing when no filters are active", () => {
    resetStore();
    const { container } = render(
      <ActiveFilterChips filters={DEFAULT_FILTERS} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
