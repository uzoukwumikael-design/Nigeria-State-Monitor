import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionalDialog } from "@/components/dashboard/regional-dialog";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { filterEvents } from "@/lib/intelligence/filter";
import { buildRegionalIntelligence } from "@/lib/intelligence/regional";
import { useDashboardStore } from "@/lib/store";
import { DEFAULT_FILTERS, type ZoneId } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const filters = { ...DEFAULT_FILTERS };

function resetStore() {
  useDashboardStore.setState({
    filters: { ...DEFAULT_FILTERS },
    selectedEventId: null,
    hoveredStateId: null,
    mobileView: "map",
    liteMode: true,
    liteSource: "manual",
    liteResolved: true,
    regionalOpen: false,
    regionalZone: null,
    regionalDays: 14,
  });
}

function regionalResponse(zone: ZoneId | null) {
  const filtered = filterEvents(
    snapshot.events,
    filters,
    snapshot.referenceTime,
  );
  return {
    data: buildRegionalIntelligence(
      filtered,
      filters,
      snapshot.referenceTime,
      zone,
      14,
    ),
  };
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegionalDialog referenceTime={DEMO_REFERENCE_TIME} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  // Unmount before resetting dialog state so Radix presence updates do not
  // fire against a still-mounted tree and produce act() warnings.
  cleanup();
  resetStore();
  vi.restoreAllMocks();
});

describe("regional intelligence dialog", () => {
  it("selects a zone profile and applies it to the dashboard", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ regionalOpen: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const zone = (url.searchParams.get("zone") as ZoneId | null) ?? null;
        return {
          ok: true,
          json: async () => regionalResponse(zone),
        } as Response;
      }),
    );

    renderDialog();

    expect(
      await screen.findByTestId("regional-zone-north-east"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/^regional-zone-/)).toHaveLength(6);
    expect(screen.getByText("Zone comparison")).toBeInTheDocument();
    expect(
      screen.queryByTestId("regional-profile-north-east"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("regional-zone-north-east"));
    expect(useDashboardStore.getState().regionalZone).toBe("north-east");

    const profile = await screen.findByTestId("regional-profile-north-east");
    expect(
      within(profile).getByRole("heading", { name: "North East" }),
    ).toBeInTheDocument();
    expect(
      within(profile).getByText(/fictional demo event/),
    ).toBeInTheDocument();
    expect(
      within(profile).getByRole("heading", { name: "Reported-volume trend" }),
    ).toBeInTheDocument();
    expect(
      within(profile).getByRole("group", { name: "Regional trend range" }),
    ).toBeInTheDocument();
    expect(
      within(profile).getByRole("heading", { name: "State coverage" }),
    ).toBeInTheDocument();
    expect(
      within(profile).getByRole("heading", { name: "Latest demo records" }),
    ).toBeInTheDocument();

    await user.click(
      within(profile).getByRole("button", {
        name: /Filter dashboard to North East/,
      }),
    );
    expect(useDashboardStore.getState().filters.zone).toBe("north-east");
    expect(useDashboardStore.getState().regionalOpen).toBe(false);
  });

  it("changes the trend range and restores zero counts without inventing data", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({
      regionalOpen: true,
      regionalZone: "south-west",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const zone = (url.searchParams.get("zone") as ZoneId | null) ?? null;
        const days = Number(url.searchParams.get("days") ?? 14);
        const filtered = filterEvents(
          snapshot.events,
          filters,
          snapshot.referenceTime,
        );
        return {
          ok: true,
          json: async () => ({
            data: buildRegionalIntelligence(
              filtered,
              filters,
              snapshot.referenceTime,
              zone,
              days,
            ),
          }),
        } as Response;
      }),
    );

    renderDialog();
    const profile = await screen.findByTestId("regional-profile-south-west");
    await user.click(within(profile).getByRole("button", { name: "30D" }));
    expect(useDashboardStore.getState().regionalDays).toBe(30);
  });

  it("shows an explicit error state with a retry control", async () => {
    resetStore();
    useDashboardStore.setState({ regionalOpen: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    renderDialog();
    expect(
      await screen.findByText("Regional data is unavailable", undefined, {
        timeout: 5_000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
