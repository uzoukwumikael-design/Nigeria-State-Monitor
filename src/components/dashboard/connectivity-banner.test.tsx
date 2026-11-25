import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectivityBanner } from "@/components/dashboard/connectivity-banner";
import { useConnectivityStore } from "@/lib/offline/store";

function reset() {
  useConnectivityStore.setState({
    online: true,
    cachedAt: null,
    cachedCount: 0,
  });
}

function renderBanner() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ConnectivityBanner datasetAsOf="2026-11-02T09:00:00.000Z" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  reset();
  vi.unstubAllGlobals();
});

describe("connectivity banner", () => {
  it("renders nothing while online with no saved responses served", () => {
    reset();
    renderBanner();
    expect(screen.queryByTestId("connectivity-banner")).not.toBeInTheDocument();
  });

  it("says plainly that the screen is offline and gives the dataset time", () => {
    reset();
    useConnectivityStore.setState({ online: false });
    renderBanner();
    const banner = screen.getByTestId("connectivity-banner");
    expect(banner).toHaveTextContent("You are offline");
    expect(banner).toHaveTextContent(/saved on this device/i);
    expect(banner).toHaveTextContent(/dataset as of/i);
  });

  it("flags saved copies served while technically online", () => {
    reset();
    useConnectivityStore.getState().noteCached("2026-11-01T08:00:00.000Z");
    useConnectivityStore.getState().noteCached("2026-11-02T08:00:00.000Z");
    renderBanner();
    const banner = screen.getByTestId("connectivity-banner");
    expect(banner).toHaveTextContent("Saved data, not live");
    expect(banner).toHaveTextContent(/oldest from/);
    expect(useConnectivityStore.getState().cachedAt).toBe(
      "2026-11-01T08:00:00.000Z",
    );
    expect(useConnectivityStore.getState().cachedCount).toBe(2);
  });

  it("clears once a retry reaches the server", async () => {
    const user = userEvent.setup({ delay: null });
    reset();
    useConnectivityStore.getState().noteCached("2026-11-01T08:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 }) as Response),
    );
    renderBanner();
    await user.click(screen.getByRole("button", { name: /retry now/i }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("connectivity-banner"),
      ).not.toBeInTheDocument(),
    );
  });

  it("stays visible when the retry still cannot reach the server", async () => {
    const user = userEvent.setup({ delay: null });
    reset();
    useConnectivityStore.setState({ online: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    renderBanner();
    await user.click(screen.getByRole("button", { name: /retry now/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retry now/i })).toBeEnabled(),
    );
    expect(screen.getByTestId("connectivity-banner")).toBeInTheDocument();
  });
});
