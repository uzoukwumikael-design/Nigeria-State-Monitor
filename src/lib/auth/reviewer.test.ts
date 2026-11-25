// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MIN_SESSION_SECRET_LENGTH,
  isSameOrigin,
  parseReviewerCredentials,
  reviewerAuthStatus,
  signReviewerSession,
  verifyReviewerSession,
  verifyReviewerToken,
} from "@/lib/auth/reviewer";

const SESSION_SECRET = "s".repeat(MIN_SESSION_SECRET_LENGTH);
const SECRET_A = "a".repeat(24);
const SECRET_B = "b".repeat(24);

describe("reviewer credentials", () => {
  it("parses comma-separated reviewer IDs and preserves colons in secrets", () => {
    const credentials = parseReviewerCredentials(
      `Duty.Editor:${SECRET_A}, night-desk:${SECRET_B}:with:colons`,
    );
    expect(credentials.size).toBe(2);
    expect(credentials.get("duty.editor")).toBe(SECRET_A);
    expect(credentials.get("night-desk")).toBe(`${SECRET_B}:with:colons`);
  });

  it("fails closed for malformed, duplicate or weak entries", () => {
    expect(() => parseReviewerCredentials("missing-separator")).toThrow(/reviewer-id:secret/);
    expect(() => parseReviewerCredentials(`UPPER:${SECRET_A},upper:${SECRET_B}`)).toThrow(
      /Duplicate reviewer ID/,
    );
    expect(() =>
      parseReviewerCredentials(`duplicate:${SECRET_A},duplicate:${SECRET_B}`),
    ).toThrow(/Duplicate reviewer ID/);
    expect(() => parseReviewerCredentials("short:" + "x".repeat(10))).toThrow(
      /non-whitespace characters/,
    );
    expect(() => parseReviewerCredentials("bad id:" + SECRET_A)).toThrow(/Invalid reviewer ID/);
  });

  it("reports configuration status without exposing secrets", () => {
    expect(reviewerAuthStatus({})).toMatchObject({ ok: false });
    expect(
      reviewerAuthStatus({ REVIEWER_CREDENTIALS: `duty.editor:${SECRET_A}` }),
    ).toMatchObject({ ok: false });
    expect(
      reviewerAuthStatus({
        REVIEWER_CREDENTIALS: `duty.editor:${SECRET_A}`,
        REVIEWER_SESSION_SECRET: "too-short",
      }),
    ).toMatchObject({ ok: false });
    expect(
      reviewerAuthStatus({
        REVIEWER_CREDENTIALS: `duty.editor:${SECRET_A},night-desk:${SECRET_B}`,
        REVIEWER_SESSION_SECRET: SESSION_SECRET,
      }),
    ).toEqual({ ok: true, reviewers: 2 });
  });

  it("compares tokens without accepting an unknown reviewer", () => {
    const credentials = parseReviewerCredentials(`duty.editor:${SECRET_A}`);
    expect(verifyReviewerToken(credentials, "duty.editor", SECRET_A)).toBe(true);
    expect(verifyReviewerToken(credentials, "DUTY.EDITOR", SECRET_A)).toBe(true);
    expect(verifyReviewerToken(credentials, "duty.editor", SECRET_B)).toBe(false);
    expect(verifyReviewerToken(credentials, "unknown", SECRET_A)).toBe(false);
  });
});

describe("reviewer sessions", () => {
  const now = new Date("2026-11-07T10:00:00.000Z");
  const credentials = parseReviewerCredentials(`duty.editor:${SECRET_A}`);

  it("signs and verifies a short-lived session", () => {
    const signed = signReviewerSession("Duty.Editor", SESSION_SECRET, now, 3_600);
    expect(signed.session.reviewerId).toBe("duty.editor");
    expect(signed.session.expiresAtMs).toBe(now.getTime() + 3_600_000);
    expect(signed.value).not.toContain(SECRET_A);
    expect(signed.value).not.toContain("duty.editor");

    const verified = verifyReviewerSession(signed.value, credentials, SESSION_SECRET, now);
    expect(verified).toMatchObject({
      reviewerId: "duty.editor",
      expiresAt: "2026-11-07T11:00:00.000Z",
    });
  });

  it("rejects tampered, expired, removed and malformed sessions", () => {
    const signed = signReviewerSession("duty.editor", SESSION_SECRET, now, 3_600);
    const [payload, signature] = signed.value.split(".");
    expect(
      verifyReviewerSession(
        `${payload}.${signature?.slice(0, -1)}x`,
        credentials,
        SESSION_SECRET,
        now,
      ),
    ).toBeNull();
    expect(
      verifyReviewerSession(signed.value, credentials, "x".repeat(MIN_SESSION_SECRET_LENGTH), now),
    ).toBeNull();
    expect(
      verifyReviewerSession(
        signed.value,
        parseReviewerCredentials(`other.reviewer:${SECRET_B}`),
        SESSION_SECRET,
        now,
      ),
    ).toBeNull();
    expect(
      verifyReviewerSession(
        signed.value,
        credentials,
        SESSION_SECRET,
        new Date(now.getTime() + 3_601_000),
      ),
    ).toBeNull();
    expect(verifyReviewerSession("not-a-session", credentials, SESSION_SECRET, now)).toBeNull();
    expect(verifyReviewerSession(undefined, credentials, SESSION_SECRET, now)).toBeNull();
  });

  it("refuses to sign invalid identifiers or short secrets", () => {
    expect(() => signReviewerSession("X", SESSION_SECRET, now)).toThrow(/invalid reviewer ID/);
    expect(() => signReviewerSession("duty.editor", "short", now)).toThrow(/REVIEWER_SESSION_SECRET/);
    expect(() => signReviewerSession("duty.editor", SESSION_SECRET, now, 10)).toThrow(/TTL/);
  });
});

describe("same-origin mutation checks", () => {
  it("accepts exactly the requesting origin and host", () => {
    expect(isSameOrigin("https://nsm.example/review", "https://nsm.example", "nsm.example")).toBe(
      true,
    );
    expect(isSameOrigin("https://nsm.example/review", "http://nsm.example", "nsm.example")).toBe(
      false,
    );
    expect(isSameOrigin("https://nsm.example/review", "https://evil.example", "nsm.example")).toBe(
      false,
    );
    expect(isSameOrigin("https://nsm.example/review", null, "nsm.example")).toBe(false);
    expect(isSameOrigin("https://nsm.example/review", "https://nsm.example", null)).toBe(false);
  });
});
