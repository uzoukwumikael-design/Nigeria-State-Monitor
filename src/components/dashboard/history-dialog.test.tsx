import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryDialog } from "@/components/dashboard/history-dialog";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import {
  buildHistory,
  resolveHistoryRange,
  type HistoryRangeRequest,
} from "@/lib/intelligence/history";
import { useDashboardStore } from "@/lib/store";
import { DEFAULT_FILTERS } from "@/lib/types";

const snapshot = buildDemoSnapshot();

function historyFor(url: URL) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const request: HistoryRangeRequest =
    from && to
      ? { kind: "custom", from, to }
      : {
          kind: "window",
          window: (url.searchParams.get("window") as "30d") ?? "90d",
        };
  const resolved = resolveHistoryRange(
    request,
    snapshot.referenceTime,
    snapshot.coverage,
  );
  if (!resolved.ok) throw new Error(resolved.message);
  return buildHistory({
    events: snapshot.events,
    states: snapshot.states,
    coverage: snapshot.coverage,
    referenceIso: snapshot.referenceTime,
    range: resolved.range,
    scope: {
      stateId: url.searchParams.get("state"),
      zone: url.searchParams.get("zone") as never,
      category: url.searchParams.get("category") as never,
    },
  });
}

function stubFetch(handler?: (url: URL) => unknown) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    try {
      const data = handler ? handler(url) : historyFor(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data }),
      } as Response;
    } catch (error) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: error instanceof Error ? error.message : "bad" },
        }),
      } as Response;
    }
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function resetStore() {
  useDashboardStore.setState({
    filters: { ...DEFAULT_FILTERS },
    historyOpen: false,
    selectedEventId: null,
  });
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HistoryDialog referenceTime={DEMO_REFERENCE_TIME} />
    </QueryClientProvider>,
  );
}

const lastUrl = (mock: ReturnType<typeof stubFetch>) =>
  new URL(String(mock.mock.calls.at(-1)?.[0]), "http://localhost");

afterEach(() => {
  cleanup();
  resetStore();
  vi.unstubAllGlobals();
});

describe("history dialog", () => {
  it("loads a default 90-day history with coverage disclosure and honest labels", async () => {
    resetStore();
    useDashboardStore.setState({ historyOpen: true });
    const mock = stubFetch();
    renderDialog();

    const coverage = await screen.findByTestId("history-coverage");
    expect(coverage).toHaveTextContent("Fictional demo snapshot");
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(screen.getByText("Reported events")).toBeInTheDocument();
    expect(screen.getAllByText(/not (incidence|risk)/i).length).toBeGreaterThan(
      0,
    );
    expect(lastUrl(mock).searchParams.get("window")).toBe("90d");
  });

  it("switches presets and applies a custom date range", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ historyOpen: true });
    const mock = stubFetch();
    renderDialog();
    await screen.findByTestId("history-coverage");

    await user.click(screen.getByRole("button", { name: "30 days" }));
    await waitFor(() =>
      expect(lastUrl(mock).searchParams.get("window")).toBe("30d"),
    );

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-10-15" },
    });
    await user.click(screen.getByRole("button", { name: "Apply dates" }));
    await waitFor(() => {
      const url = lastUrl(mock);
      expect(url.searchParams.get("from")).toBe("2026-10-01");
      expect(url.searchParams.get("to")).toBe("2026-10-15");
      expect(url.searchParams.get("window")).toBeNull();
    });
  });

  it("refuses an end date before the start date without calling the API", async () => {
    resetStore();
    useDashboardStore.setState({ historyOpen: true });
    const mock = stubFetch();
    renderDialog();
    await screen.findByTestId("history-coverage");
    const calls = mock.mock.calls.length;

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-10-01" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /start date must not be after the end date/i,
    );
    expect(screen.getByRole("button", { name: "Apply dates" })).toBeDisabled();
    expect(mock.mock.calls.length).toBe(calls);
  });

  it("starts from the dashboard's current state scope and can change it", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({
      historyOpen: true,
      filters: { ...DEFAULT_FILTERS, stateId: "NG-LA" },
    });
    const mock = stubFetch();
    renderDialog();
    await waitFor(() =>
      expect(lastUrl(mock).searchParams.get("state")).toBe("NG-LA"),
    );
    expect(await screen.findByText(/Lagos/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("State"), "");
    await waitFor(() =>
      expect(lastUrl(mock).searchParams.get("state")).toBeNull(),
    );
    await user.selectOptions(
      screen.getByLabelText("Geopolitical zone"),
      "north-west",
    );
    await waitFor(() =>
      expect(lastUrl(mock).searchParams.get("zone")).toBe("north-west"),
    );
  });

  it("opens an event from the timeline and closes", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ historyOpen: true });
    stubFetch();
    renderDialog();
    const timeline = await screen.findByRole("region", {
      name: "Timeline of notable events",
    });
    const first = within(timeline).getAllByRole("button")[0]!;
    await user.click(first);
    expect(useDashboardStore.getState().selectedEventId).not.toBeNull();
    expect(useDashboardStore.getState().historyOpen).toBe(false);
  });

  it("shows an error with retry when the API fails", async () => {
    const user = userEvent.setup({ delay: null });
    resetStore();
    useDashboardStore.setState({ historyOpen: true });
    let failing = true;
    stubFetch((url) => {
      if (failing) throw new Error("Server exploded");
      return historyFor(url);
    });
    renderDialog();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("History could not be loaded");
    expect(alert).toHaveTextContent("Server exploded");
    failing = false;
    await user.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByTestId("history-coverage")).toBeInTheDocument();
  });
});
