import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  REVIEWER_COOKIE,
  isSameOrigin,
  parseReviewerCredentials,
  reviewerAuthStatus,
  verifyReviewerSession,
  type ReviewerSession,
} from "@/lib/auth/reviewer";

export interface ReviewApiContext {
  reviewerId: string;
  expiresAt: string;
}

function sessionFromCookieValue(value: string | undefined): ReviewerSession | null {
  const status = reviewerAuthStatus(process.env);
  if (!status.ok) return null;
  try {
    return verifyReviewerSession(
      value,
      parseReviewerCredentials(process.env.REVIEWER_CREDENTIALS),
      process.env.REVIEWER_SESSION_SECRET?.trim() ?? "",
    );
  } catch {
    return null;
  }
}

export function reviewerFromRequest(request: NextRequest): ReviewerSession | null {
  return sessionFromCookieValue(request.cookies.get(REVIEWER_COOKIE)?.value);
}

export async function reviewerFromCookies(): Promise<ReviewerSession | null> {
  const store = await cookies();
  return sessionFromCookieValue(store.get(REVIEWER_COOKIE)?.value);
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string = crypto.randomUUID(),
): NextResponse {
  return NextResponse.json(
    { error: { code, message }, requestId },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Cookie-authenticated API guard. Mutations additionally require a same-origin
 * Origin header, which combines with SameSite=Strict to block cross-site posts.
 */
export function guardReviewApi(
  request: NextRequest,
  options: { mutation: boolean },
): { ok: true; context: ReviewApiContext } | { ok: false; response: NextResponse } {
  const configured = reviewerAuthStatus(process.env);
  if (!configured.ok) {
    return {
      ok: false,
      response: errorResponse("reviewer_auth_unavailable", configured.message, 503),
    };
  }

  const session = reviewerFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: errorResponse("unauthorised", "Sign in with a configured reviewer credential.", 401),
    };
  }

  if (options.mutation) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!isSameOrigin(request.url, origin, host)) {
      return {
        ok: false,
        response: errorResponse("invalid_origin", "Mutation requests must come from the same origin.", 403),
      };
    }
  }

  return {
    ok: true,
    context: { reviewerId: session.reviewerId, expiresAt: session.expiresAt },
  };
}

export function setReviewerCookie(
  response: NextResponse,
  value: string,
  expiresAtMs: number,
): void {
  response.cookies.set({
    name: REVIEWER_COOKIE,
    value,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAtMs),
  });
}

export function clearReviewerCookie(response: NextResponse): void {
  response.cookies.set({
    name: REVIEWER_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}
