import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { enforceRateLimit } from "@/lib/api/response";
import { errorResponse, guardReviewApi } from "@/lib/auth/server";
import { reviewDatabaseAvailable } from "@/lib/data/postgres/review-database";
import { flattenZodError } from "@/lib/validation/query";

export interface ReviewRouteContext {
  reviewerId: string;
  expiresAt: string;
  requestId: string;
}

export function reviewOk(
  data: unknown,
  requestId: string,
  meta: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { data, meta: { mode: "postgres", ...meta }, requestId },
    { headers: { "cache-control": "no-store" } },
  );
}

function validationError(error: z.ZodError, requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
        details: flattenZodError(error),
      },
      requestId,
    },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Rate-limits, authenticates and authorises a reviewer API request. Mutations
 * must be same-origin in addition to carrying a valid HttpOnly session cookie.
 * The database is only checked after authentication so an anonymous caller
 * cannot probe deployment configuration.
 */
export async function guardReviewRoute(
  request: NextRequest,
  options: { scope: string; mutation: boolean; limit?: number },
): Promise<{ ok: true; context: ReviewRouteContext } | { ok: false; response: NextResponse }> {
  const requestId = crypto.randomUUID();
  const rate = await enforceRateLimit(
    request,
    options.scope,
    options.limit ?? (options.mutation ? 60 : 240),
  );
  if (!rate.allowed) {
    return {
      ok: false,
      response: errorResponse(
        "rate_limited",
        "Too many requests. Try again shortly.",
        429,
        requestId,
      ),
    };
  }

  const guarded = guardReviewApi(request, { mutation: options.mutation });
  if (!guarded.ok) return { ok: false, response: guarded.response };

  if (!reviewDatabaseAvailable()) {
    return {
      ok: false,
      response: errorResponse(
        "review_database_unavailable",
        "Reviewer actions require NSM_REPOSITORY=postgres and a server-side DATABASE_URL.",
        503,
        requestId,
      ),
    };
  }

  return {
    ok: true,
    context: {
      reviewerId: guarded.context.reviewerId,
      expiresAt: guarded.context.expiresAt,
      requestId,
    },
  };
}

export async function parseReviewBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const requestId = crypto.randomUUID();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(
        "invalid_json",
        "The request body must be valid JSON.",
        400,
        requestId,
      ),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: validationError(parsed.error, requestId) };
  }
  return { ok: true, data: parsed.data };
}

export function parseReviewQuery<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const requestId = crypto.randomUUID();
  const raw: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) raw[key] = value;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: validationError(parsed.error, requestId) };
  }
  return { ok: true, data: parsed.data };
}

const CONFLICT_CODES = new Set([
  "already_decided",
  "already_linked",
  "stale_status",
  "no_change",
  "terminal_retracted",
  "invalid_transition",
  "insufficient_evidence",
  "conflicting_evidence",
  "corroboration_approval_required",
  "event_unavailable",
  "candidate_unavailable",
]);

/** Maps a store-level failure to an HTTP status without leaking internals. */
export function reviewFailure(code: string, message: string): NextResponse {
  const status =
    code === "not_found"
      ? 404
      : CONFLICT_CODES.has(code)
        ? 409
        : code === "internal"
          ? 500
          : 400;
  return errorResponse(code, message, status);
}
