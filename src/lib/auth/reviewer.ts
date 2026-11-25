import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { REVIEWER_ID_PATTERN } from "@/lib/review/decide";

export const REVIEWER_COOKIE = "nsm_reviewer";
export const REVIEWER_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MIN_REVIEWER_SECRET_LENGTH = 24;
export const MIN_SESSION_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;

export type ReviewEnv = Record<string, string | undefined>;

export interface ReviewerSession {
  reviewerId: string;
  expiresAt: string;
  expiresAtMs: number;
}

export type ReviewAuthStatus =
  | { ok: true; reviewers: number }
  | { ok: false; message: string };

function normalizeReviewerId(value: string): string {
  return value.trim().toLowerCase();
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function validSecretShape(value: string): boolean {
  return (
    value.length >= MIN_REVIEWER_SECRET_LENGTH &&
    value.length <= MAX_SECRET_LENGTH &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}

/**
 * Parses `REVIEWER_CREDENTIALS` as comma-separated `reviewer-id:secret` pairs.
 * Secrets may contain colons because only the first colon is a separator. A
 * malformed map fails closed instead of silently disabling authentication.
 */
export function parseReviewerCredentials(raw: string | undefined): Map<string, string> {
  const credentials = new Map<string, string>();
  const value = raw?.trim();
  if (!value) return credentials;

  for (const entry of value.split(",")) {
    const pair = entry.trim();
    if (!pair) continue;
    const separator = pair.indexOf(":");
    if (separator <= 0) {
      throw new Error("REVIEWER_CREDENTIALS entries must use reviewer-id:secret.");
    }
    const reviewerId = normalizeReviewerId(pair.slice(0, separator));
    const secret = pair.slice(separator + 1).trim();
    if (!REVIEWER_ID_PATTERN.test(reviewerId)) {
      throw new Error(`Invalid reviewer ID in REVIEWER_CREDENTIALS: ${reviewerId || "(empty)"}.`);
    }
    if (!validSecretShape(secret)) {
      throw new Error(
        `Reviewer secret for ${reviewerId} must be ${MIN_REVIEWER_SECRET_LENGTH}–${MAX_SECRET_LENGTH} non-whitespace characters.`,
      );
    }
    if (credentials.has(reviewerId)) {
      throw new Error(`Duplicate reviewer ID in REVIEWER_CREDENTIALS: ${reviewerId}.`);
    }
    credentials.set(reviewerId, secret);
  }

  return credentials;
}

export function reviewerAuthStatus(env: ReviewEnv = process.env): ReviewAuthStatus {
  try {
    const credentials = parseReviewerCredentials(env.REVIEWER_CREDENTIALS);
    if (credentials.size === 0) {
      return {
        ok: false,
        message:
          "Reviewer authentication is not configured. Set REVIEWER_CREDENTIALS and REVIEWER_SESSION_SECRET on the server.",
      };
    }
    const secret = env.REVIEWER_SESSION_SECRET?.trim() ?? "";
    if (secret.length < MIN_SESSION_SECRET_LENGTH || /[\u0000-\u0020\u007f]/.test(secret)) {
      return {
        ok: false,
        message: `REVIEWER_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} non-whitespace characters.`,
      };
    }
    return { ok: true, reviewers: credentials.size };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Reviewer authentication configuration is invalid.",
    };
  }
}

export function verifyReviewerToken(
  credentials: ReadonlyMap<string, string>,
  reviewerId: string,
  token: string,
): boolean {
  const id = normalizeReviewerId(reviewerId);
  const expected = credentials.get(id);
  if (!expected) {
    // Still perform a comparison so an unknown ID does not return measurably
    // faster than a wrong secret for a known ID.
    constantTimeEqual(token, "invalid-reviewer-token");
    return false;
  }
  return constantTimeEqual(token, expected);
}

function base64url(value: string | Buffer): string {
  return (Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8")).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payload, "utf8").digest());
}

export interface SignedReviewerSession {
  value: string;
  session: ReviewerSession;
}

/**
 * Issues an HttpOnly-cookie value. The reviewer ID and expiry are signed; no
 * secret is placed in the cookie and no server-side session table is needed.
 */
export function signReviewerSession(
  reviewerId: string,
  secret: string,
  now: Date = new Date(),
  ttlSeconds: number = REVIEWER_SESSION_TTL_SECONDS,
): SignedReviewerSession {
  const id = normalizeReviewerId(reviewerId);
  if (!REVIEWER_ID_PATTERN.test(id)) throw new Error("Cannot sign an invalid reviewer ID.");
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error("Cannot sign a session without a sufficient REVIEWER_SESSION_SECRET.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 24 * 60 * 60) {
    throw new Error("Reviewer session TTL must be between 60 seconds and 24 hours.");
  }
  const expiresAtMs = now.getTime() + ttlSeconds * 1_000;
  const payload = base64url(JSON.stringify({ sub: id, exp: Math.floor(expiresAtMs / 1_000) }));
  return {
    value: `${payload}.${sign(payload, secret)}`,
    session: {
      reviewerId: id,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    },
  };
}

export function verifyReviewerSession(
  value: string | undefined,
  credentials: ReadonlyMap<string, string>,
  secret: string,
  now: Date = new Date(),
): ReviewerSession | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!payload || !signature) return null;
  if (!constantTimeEqual(signature, sign(payload, secret))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.sub !== "string" || typeof record.exp !== "number") return null;
  const reviewerId = normalizeReviewerId(record.sub);
  if (!REVIEWER_ID_PATTERN.test(reviewerId)) return null;
  if (!credentials.has(reviewerId)) return null;

  const expiresAtMs = record.exp * 1_000;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) return null;
  return {
    reviewerId,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
}

/** Same-origin check for cookie-authenticated state-changing requests. */
export function isSameOrigin(
  requestUrl: string,
  origin: string | null,
  host: string | null,
): boolean {
  if (!origin || !host) return false;
  try {
    const expected = new URL(requestUrl);
    const supplied = new URL(origin);
    return supplied.origin === expected.origin && supplied.host === host;
  } catch {
    return false;
  }
}
