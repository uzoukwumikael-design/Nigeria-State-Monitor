import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewConsole } from "@/components/review/review-console";

const EXPIRES_AT = new Date(Date.now() + 8 * 60 * 60 * 1_000).toISOString();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let signedIn = false;
let fetchMock: ReturnType<typeof vi.fn>;

function sessionBody() {
  if (!signedIn) {
    return {
      data: {
        configured: true,
        signedIn: false,
        reviewerId: null,
        expiresAt: null,
        ttlSeconds: 28_800,
      },
    };
  }
  return {
    data: {
      configured: true,
      signedIn: true,
      reviewerId: "duty.editor",
      expiresAt: EXPIRES_AT,
      ttlSeconds: 28_800,
    },
  };
}

beforeEach(() => {
  signedIn = false;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith("/api/review/session")) {
      if (init?.method === "POST") {
        signedIn = true;
        return json({
          data: { reviewerId: "duty.editor", expiresAt: EXPIRES_AT },
        });
      }
      if (init?.method === "DELETE") {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      return json(sessionBody());
    }
    if (url.startsWith("/api/review/candidates")) {
      return json({ data: { candidates: [] } });
    }
    if (url.startsWith("/api/review/clusters")) {
      return json({ data: { clusters: [] } });
    }
    if (url.startsWith("/api/review/publication")) {
      return json({ data: { candidates: [] } });
    }
    if (url.startsWith("/api/review/verification")) {
      return json({ data: { events: [] } });
    }
    return json({ error: { code: "not_found", message: "Not found" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderConsole() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReviewConsole />
    </QueryClientProvider>,
  );
}

describe("reviewer console", () => {
  it("states clearly when reviewer authentication is not configured", async () => {
    fetchMock.mockImplementationOnce(async () =>
      json({
        data: {
          configured: false,
          signedIn: false,
          reviewerId: null,
          expiresAt: null,
          message: "Reviewer credentials are not configured.",
        },
      }),
    );

    renderConsole();

    expect(
      await screen.findByText("Reviewer credentials are not configured."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Reviewer ID")).not.toBeInTheDocument();
    expect(
      screen.getByText(/REVIEWER_CREDENTIALS, REVIEWER_SESSION_SECRET/),
    ).toBeInTheDocument();
  });

  it("shows the sign-in form and requires both fields", async () => {
    const user = userEvent.setup();
    renderConsole();

    const submit = await screen.findByRole("button", { name: "Sign in" });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Reviewer ID")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reviewer secret/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Reviewer ID"), "duty.editor");
    expect(submit).toBeDisabled();
    await user.type(
      screen.getByLabelText(/^Reviewer secret/),
      "correct horse battery staple",
    );
    expect(submit).toBeEnabled();
  });

  it("signs in and renders the authenticated reviewer queues", async () => {
    const user = userEvent.setup();
    renderConsole();

    const submit = await screen.findByRole("button", { name: "Sign in" });
    await user.type(screen.getByLabelText("Reviewer ID"), "duty.editor");
    await user.type(
      screen.getByLabelText(/^Reviewer secret/),
      "correct horse battery staple",
    );
    await user.click(submit);

    expect(
      await screen.findByRole("heading", { name: "Reviewer console" }),
    ).toBeInTheDocument();
    expect(screen.getByText("duty.editor")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Candidates" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Clusters" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Publication" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Verification" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No candidates in this view"),
    ).toBeInTheDocument();

    const loginCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).startsWith("/api/review/session") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(loginCalls).toHaveLength(1);
    const body = JSON.parse(String((loginCalls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({
      reviewerId: "duty.editor",
      secret: "correct horse battery staple",
    });

    await waitFor(() => {
      expect(screen.queryByText("Reviewer sign-in")).not.toBeInTheDocument();
    });
  });
});
