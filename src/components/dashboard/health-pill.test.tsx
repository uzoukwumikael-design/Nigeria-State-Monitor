import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthPill } from "@/components/dashboard/health-pill";

interface HealthOverrides {
  status: string;
  mode: string;
  database: string;
  ingestion?: string;
  aiEnrichment?: string;
  realtime?: string;
  sources?: { total: number; live: number; demo: number; healthy: number };
}

function healthResponse(overrides: HealthOverrides) {
  return {
    data: {
      status: overrides.status,
      mode: overrides.mode,
      database: overrides.database,
      ingestion: overrides.ingestion ?? "not_connected",
      aiEnrichment: overrides.aiEnrichment ?? "not_connected",
      realtime: overrides.realtime ?? "not_connected",
      lastSuccessfulSync: null,
      datasetVersion: "demo-2026-11-02.1",
      datasetGeneratedAt: "2026-11-02T09:00:00.000Z",
      referenceTime: "2026-11-02T09:00:00.000Z",
      coverage: {
        from: "2026-10-06T02:00:00.000Z",
        to: "2026-11-02T08:47:00.000Z",
        label: "Fictional demo snapshot — not live coverage",
      },
      sources: overrides.sources ?? { total: 8, live: 0, demo: 8, healthy: 0 },
      counts: { events: 74, states: 37 },
      limitations: ["Every event and source in this dataset is fictional."],
      disclaimer: "DEMO DATA — NOT A REAL INCIDENT",
    },
  };
}

function stubHealth(payload: ReturnType<typeof healthResponse>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("health pill", () => {
  it("labels a demo snapshot as static and explains that capture does not feed the dashboard", async () => {
    const user = userEvent.setup();
    stubHealth(
      healthResponse({
        status: "demo",
        mode: "demo",
        database: "not_connected",
      }),
    );

    render(<HealthPill liteMode />, { wrapper });

    const trigger = await screen.findByRole("button", {
      name: /Data status: Demo · static/i,
    });
    await user.click(trigger);

    expect(
      await screen.findByText(
        /Demo snapshot served from the active repository/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("not connected to dashboard")).toBeInTheDocument();
    expect(screen.getByText(/8 sources · 8 demo · 0 live/)).toBeInTheDocument();
    expect(
      screen.getByText(/DEMO DATA — NOT A REAL INCIDENT/),
    ).toBeInTheDocument();
  });

  it("shows degraded instead of a healthy connection when ingestion and AI are absent", async () => {
    const user = userEvent.setup();
    stubHealth(
      healthResponse({
        status: "degraded",
        mode: "production",
        database: "connected",
      }),
    );

    render(<HealthPill liteMode />, { wrapper });

    const trigger = await screen.findByRole("button", {
      name: /Data status: Degraded/i,
    });
    await user.click(trigger);

    expect(
      await screen.findByText(/Production snapshot\. No scheduled ingestion/),
    ).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.queryByText("Data connected")).not.toBeInTheDocument();
  });
});
