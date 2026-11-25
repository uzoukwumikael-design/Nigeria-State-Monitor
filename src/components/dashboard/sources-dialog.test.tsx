import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourcesDialog } from "@/components/dashboard/sources-dialog";
import type { SourceStatusRow } from "@/lib/ingestion/source-status";
import { useDashboardStore } from "@/lib/store";

const row = (overrides: Partial<SourceStatusRow>): SourceStatusRow => ({
  slug: "punch",
  name: "Punch",
  tier: "major_publisher",
  host: "punchng.com",
  licenceStatus: "restricted",
  evidenceLevel: "verified",
  evidenceNote: "HTTP 200 RSS on 2 Nov 2026.",
  state: "healthy",
  consecutiveFailures: 0,
  lastCheckedAt: "2026-11-12T11:00:00.000Z",
  lastSuccessfulSync: "2026-11-12T11:00:00.000Z",
  lastError: null,
  retryAt: null,
  articlesLast24h: 12,
  articlesTotal: 90,
  ...overrides,
});

function stub(data: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ data }) }) as Response));
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SourcesDialog referenceTime="2026-11-12T12:00:00.000Z" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useDashboardStore.setState({ sourcesOpen: false });
  vi.unstubAllGlobals();
});

describe("sources dialog", () => {
  it("shows each source with its state, evidence level, evidence note and recent activity", async () => {
    useDashboardStore.setState({ sourcesOpen: true });
    stub({
      healthAvailable: true,
      summary: { total: 3, healthy: 1, failing: 0, paused: 1, neverRun: 1, unknown: 0, disabled: 0 },
      sources: [
        row({}),
        row({ slug: "vanguard", name: "Vanguard", host: "www.vanguardngr.com", state: "paused", consecutiveFailures: 6, lastError: "Feed responded with HTTP 503.", retryAt: "2026-11-12T12:50:00.000Z", evidenceLevel: "directory", evidenceNote: "FeedSpot (Aug 2026).", articlesLast24h: 0, articlesTotal: 4 }),
        row({ slug: "herald", name: "The Herald", host: "herald.ng", state: "never_run", lastSuccessfulSync: null, articlesLast24h: 0, articlesTotal: 0, evidenceLevel: "directory", evidenceNote: "FeedSpot (Aug 2026)." }),
      ],
    });
    renderDialog();

    const list = await screen.findByRole("list", { name: "Registered news sources" });
    const punch = within(list).getByTestId("source-punch");
    expect(within(punch).getByText("Healthy")).toBeInTheDocument();
    expect(within(punch).getByText("Verified")).toBeInTheDocument();
    expect(within(punch).getByText(/12 in 24 h · 90 total/)).toBeInTheDocument();

    const vanguard = within(list).getByTestId("source-vanguard");
    expect(within(vanguard).getByText("Paused")).toBeInTheDocument();
    expect(within(vanguard).getByText("Directory only")).toBeInTheDocument();
    expect(within(vanguard).getByText(/Retry after/)).toBeInTheDocument();
    expect(within(vanguard).getByText(/HTTP 503/)).toBeInTheDocument();

    expect(within(within(list).getByTestId("source-herald")).getByText("Not run yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Source summary")).toHaveTextContent("Paused");
  });

  it("is honest when no database is connected: unknown health, no invented counts", async () => {
    useDashboardStore.setState({ sourcesOpen: true });
    stub({
      healthAvailable: false,
      summary: { total: 1, healthy: 0, failing: 0, paused: 0, neverRun: 0, unknown: 1, disabled: 0 },
      sources: [row({ state: "unknown", lastSuccessfulSync: null, articlesLast24h: null, articlesTotal: null })],
    });
    renderDialog();
    expect(await screen.findByText(/No database is connected/)).toBeInTheDocument();
    const punch = screen.getByTestId("source-punch");
    expect(within(punch).getByText("Unknown")).toBeInTheDocument();
    expect(within(punch).queryByText(/in 24 h/)).not.toBeInTheDocument();
  });

  it("shows an error with retry when the API fails", async () => {
    const user = userEvent.setup({ delay: null });
    useDashboardStore.setState({ sourcesOpen: true });
    stub({}, false);
    renderDialog();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sources could not be loaded");
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
    void user;
  });
});
