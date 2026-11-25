// @vitest-environment node

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/review/session/route";
import {
  MIN_SESSION_SECRET_LENGTH,
  REVIEWER_SESSION_TTL_SECONDS,
} from "@/lib/auth/reviewer";

const SECRET = "r".repeat(24);
const SESSION_SECRET = "s".repeat(MIN_SESSION_SECRET_LENGTH);
const REVIEWER_CREDENTIALS = `Duty.Editor:${SECRET}`;
const BASE_URL = "http://localhost:3000/api/review/session";

const saved = {
  credentials: process.env.REVIEWER_CREDENTIALS,
  secret: process.env.REVIEWER_SESSION_SECRET,
};

let ipCounter = 0;

function request(
  method: string,
  options: {
    body?: string;
    origin?: string | null;
    host?: string | null;
    cookie?: string;
  } = {},
): NextRequest {
  ipCounter += 1;
  const headers = new Headers({
    "content-type": "application/json",
    host: options.host === null ? "" : (options.host ?? "localhost:3000"),
    origin: options.origin === null ? "" : (options.origin ?? "http://localhost:3000"),
    "x-forwarded-for": `10.0.0.${ipCounter}`,
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin === null) headers.delete("origin");
  if (options.host === null) headers.delete("host");
  return new NextRequest(BASE_URL, {
    method,
    headers,
    body: options.body,
  });
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  process.env.REVIEWER_CREDENTIALS = REVIEWER_CREDENTIALS;
  process.env.REVIEWER_SESSION_SECRET = SESSION_SECRET;
});

afterEach(() => {
  delete process.env.REVIEWER_CREDENTIALS;
  delete process.env.REVIEWER_SESSION_SECRET;
});

afterAll(() => {
  if (saved.credentials === undefined) delete process.env.REVIEWER_CREDENTIALS;
  else process.env.REVIEWER_CREDENTIALS = saved.credentials;
  if (saved.secret === undefined) delete process.env.REVIEWER_SESSION_SECRET;
  else process.env.REVIEWER_SESSION_SECRET = saved.secret;
});

describe("reviewer session route", () => {
  it("reports an unconfigured deployment without exposing secrets", async () => {
    delete process.env.REVIEWER_CREDENTIALS;
    delete process.env.REVIEWER_SESSION_SECRET;

    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await payload(response)).toMatchObject({
      data: {
        configured: false,
        signedIn: false,
        reviewerId: null,
        expiresAt: null,
      },
    });
  });

  it("reports a configured deployment with no session", async () => {
    const response = await GET(request("GET"));
    expect(await payload(response)).toMatchObject({
      data: {
        configured: true,
        signedIn: false,
        reviewerId: null,
        expiresAt: null,
        ttlSeconds: REVIEWER_SESSION_TTL_SECONDS,
      },
    });
  });

  it("rejects cross-origin sign-in attempts before checking credentials", async () => {
    const response = await POST(
      request("POST", {
        origin: "https://evil.example",
        body: JSON.stringify({ reviewerId: "duty.editor", secret: SECRET }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await payload(response)).toMatchObject({
      error: { code: "invalid_origin" },
    });
  });

  it("returns stable validation and credential failures", async () => {
    const malformed = await POST(
      request("POST", {
        body: "{not json",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await payload(malformed)).toMatchObject({
      error: { code: "invalid_json" },
    });

    const invalid = await POST(
      request("POST", {
        body: JSON.stringify({ reviewerId: "duty.editor", secret: "wrong-secret" }),
      }),
    );
    expect(invalid.status).toBe(401);
    expect(await payload(invalid)).toMatchObject({
      error: { code: "invalid_credentials" },
    });

    const unknown = await POST(
      request("POST", {
        body: JSON.stringify({ reviewerId: "unknown.reviewer", secret: SECRET }),
      }),
    );
    expect(unknown.status).toBe(401);
  });

  it("signs in, sets an HttpOnly same-site cookie, and resolves the session", async () => {
    const response = await POST(
      request("POST", {
        body: JSON.stringify({ reviewerId: "Duty.Editor", secret: SECRET }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body).toMatchObject({
      data: { reviewerId: "duty.editor" },
    });
    expect(typeof (body.data as { expiresAt?: unknown }).expiresAt).toBe("string");

    const cookie = response.cookies.get("nsm_reviewer");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
    expect(cookie?.path).toBe("/");

    const session = await GET(
      request("GET", {
        cookie: `nsm_reviewer=${cookie?.value}`,
      }),
    );
    expect(await payload(session)).toMatchObject({
      data: {
        configured: true,
        signedIn: true,
        reviewerId: "duty.editor",
        ttlSeconds: REVIEWER_SESSION_TTL_SECONDS,
      },
    });
  });

  it("requires same-origin sign-out and clears the cookie", async () => {
    const crossOrigin = await DELETE(request("DELETE", { origin: "https://evil.example" }));
    expect(crossOrigin.status).toBe(403);

    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(204);
    expect(response.cookies.get("nsm_reviewer")?.value).toBe("");
  });
});
