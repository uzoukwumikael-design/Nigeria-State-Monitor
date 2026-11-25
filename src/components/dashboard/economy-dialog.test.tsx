import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EconomyDialog } from "@/components/dashboard/economy-dialog";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import { INDICATORS, WORLD_BANK_SOURCE } from "@/lib/economy/indicators";
import { summariseSeries } from "@/lib/economy/service";
import type { EconomySnapshot } from "@/lib/economy/types";
import { useDashboardStore } from "@/lib/store";
import { DEFAULT_FILTERS } from "@/lib/types";

const snapshot = buildDemoSnapshot();

// TEST FIXTURE: synthetic values only (not Nigerian statistics).
function fixtureSnapshot(
  overrides: { stale?: boolean; failFirst?: boolean } = {},
): EconomySnapshot {
  return {
    indicators: INDICATORS.map((definition, index) => {
      if (overrides.failFirst && index === 0) {
        return summariseSeries(
          {
            definition,
            observations: [],
            sourceLastUpdated: null,
            retrievedAt: new Date(0).toISOString(),
          },
          "World Bank API responded 500.",
        );
      }
      return summariseSeries({
        definition,
        observations: [
          {
            year: 2000,
            value: 1,
            referencePeriodStart: "2000-01-01",
            referencePeriodEnd: "2000-12-31",
          },
          {
            year: 2001,
            value: 3,
            referencePeriodStart: "2001-01-01",
            referencePeriodEnd: "2001-12-31",
          },
        ],
        sourceLastUpdated: "2000-01-02",
        retrievedAt: "2000-01-03T00:00:00.000Z",
      });
    }),
    retrievedAt: "2000-01-03T00:00:00.000Z",
    stale: overrides.stale ?? false,
    source: { ...WORLD_BANK_SOURCE },
  };
}

function resetStore() {
  useDashboardStore.setState({
    filters: { ...DEFAULT_FILTERS },
    economyOpen: false,
    selectedEventId: null,
  });
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EconomyDialog
        events={snapshot.events}
        referenceTime={DEMO_REFERENCE_TIME}
      />
    </QueryClientProvider>,
  );
}

function stubFetch(
  handler: (url: URL) => { ok: boolean; status?: number; body: unknown },
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const result = handler(new URL(String(input), "http://localhost"));
    return {
      ok: result.ok,
      status: result.status ?? (result.ok ? 200 : 500),
      json: async () => result.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  resetStore();
  vi.unstubAllGlobals();
});

describe("economy dialog", () => {
  it("shows each indicator with its own reference year, status and source, and loads a trend on selection", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ economyOpen: true });
    const data = fixtureSnapshot();
    const fetchMock = stubFetch((url) =>
      url.pathname === "/api/economy/indicators"
        ? { ok: true, body: { data } }
        : {
            ok: true,
            body: {
              data: {
                code: url.searchParams.get("code"),
                name: "x",
                unit: "u",
                observations: [
                  { year: 2000, value: 1 },
                  { year: 2001, value: 3 },
                ],
                sourceLastUpdated: null,
                stale: false,
                error: null,
              },
            },
          },
    );
    renderDialog();

    const list = await screen.findByRole("list", {
      name: "National economic indicators",
    });
    const inflation = within(list).getByTestId(
      `indicator-${INDICATORS[0]!.code}`,
    );
    expect(
      within(inflation).getByText("Reference year 2001"),
    ).toBeInTheDocument();
    expect(within(inflation).getByText("+2.0 pp vs 2000")).toBeInTheDocument();
    expect(within(inflation).getByText("Official")).toBeInTheDocument();
    expect(
      within(inflation).getByText(/source updated 2000-01-02/),
    ).toBeInTheDocument();

    const unemployment = within(list).getByTestId("indicator-SL.UEM.TOTL.ZS");
    expect(within(unemployment).getByText("Modelled")).toBeInTheDocument();
    expect(screen.getByText(/CC BY 4.0/)).toBeInTheDocument();

    await user.click(unemployment);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("code=SL.UEM.TOTL.ZS"),
        ),
      ).toBe(true);
    });
  });

  it("shows no figures and a retry when the source is unavailable", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ economyOpen: true });
    let attempts = 0;
    stubFetch((url) => {
      if (url.pathname !== "/api/economy/indicators") {
        return {
          ok: true,
          body: {
            data: {
              observations: [
                { year: 2000, value: 1 },
                { year: 2001, value: 3 },
              ],
            },
          },
        };
      }
      attempts += 1;
      return attempts <= 1
        ? {
            ok: false,
            status: 503,
            body: {
              error: { message: "Economic indicators could not be retrieved." },
            },
          }
        : { ok: true, body: { data: fixtureSnapshot() } };
    });
    renderDialog();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Economic indicators are unavailable");
    expect(alert).toHaveTextContent("No figures are shown");
    expect(
      screen.queryByRole("list", { name: "National economic indicators" }),
    ).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(
      await screen.findByRole("list", { name: "National economic indicators" }),
    ).toBeInTheDocument();
  });

  it("marks a failed indicator and warns when copies are stale", async () => {
    resetStore();
    useDashboardStore.setState({ economyOpen: true });
    stubFetch(() => ({
      ok: true,
      body: { data: fixtureSnapshot({ stale: true, failFirst: true }) },
    }));
    renderDialog();

    const first = await screen.findByTestId(`indicator-${INDICATORS[0]!.code}`);
    expect(
      within(first).getByText(/Could not be retrieved\. No figure shown\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /saved copies because the World Bank API could not be refreshed/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 of 8 indicators could not be retrieved/),
    ).toBeInTheDocument();
  });

  it("keeps news-derived economy reports separate and can filter the feed", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ economyOpen: true });
    stubFetch(() => ({ ok: true, body: { data: fixtureSnapshot() } }));
    renderDialog();

    const section = await screen.findByRole("region", {
      name: "Economy and business reports",
    });
    expect(
      within(section).getByText(/News-derived · not economic statistics/),
    ).toBeInTheDocument();
    expect(within(section).getByText("Demo data")).toBeInTheDocument();

    await user.click(
      within(section).getByRole("button", {
        name: /filter the feed to economy/i,
      }),
    );
    expect(useDashboardStore.getState().filters.category).toBe("economy");
    expect(useDashboardStore.getState().economyOpen).toBe(false);
  });
});
