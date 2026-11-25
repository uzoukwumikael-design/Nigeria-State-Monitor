import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api/response";
import { errorResponse, clearReviewerCookie, reviewerFromRequest, setReviewerCookie } from "@/lib/auth/server";
import {
  REVIEWER_SESSION_TTL_SECONDS,
  isSameOrigin,
  parseReviewerCredentials,
  reviewerAuthStatus,
  signReviewerSession,
  verifyReviewerToken,
} from "@/lib/auth/reviewer";
import { parseReviewBody } from "@/lib/api/review-route";
import { reviewerLoginSchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function sameOrigin(request: NextRequest): boolean {
  return isSameOrigin(
    request.url,
    request.headers.get("origin"),
    request.headers.get("host"),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const status = reviewerAuthStatus(process.env);
  if (!status.ok) {
    return NextResponse.json(
      {
        data: {
          configured: false,
          signedIn: false,
          reviewerId: null,
          expiresAt: null,
          message: status.message,
        },
      },
      { headers: NO_STORE },
    );
  }

  const session = reviewerFromRequest(request);
  return NextResponse.json(
    {
      data: {
        configured: true,
        signedIn: Boolean(session),
        reviewerId: session?.reviewerId ?? null,
        expiresAt: session?.expiresAt ?? null,
        ttlSeconds: REVIEWER_SESSION_TTL_SECONDS,
      },
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rate = await enforceRateLimit(request, "reviewer-login", 10);
  if (!rate.allowed) {
    return errorResponse(
      "rate_limited",
      "Too many sign-in attempts. Try again shortly.",
      429,
    );
  }
  if (!sameOrigin(request)) {
    return errorResponse(
      "invalid_origin",
      "Sign-in requests must come from the same origin.",
      403,
    );
  }

  const body = await parseReviewBody(request, reviewerLoginSchema);
  if (!body.ok) return body.response;

  const status = reviewerAuthStatus(process.env);
  if (!status.ok) {
    return errorResponse("reviewer_auth_unavailable", status.message, 503);
  }

  try {
    const credentials = parseReviewerCredentials(process.env.REVIEWER_CREDENTIALS);
    if (!verifyReviewerToken(credentials, body.data.reviewerId, body.data.secret.trim())) {
      return errorResponse(
        "invalid_credentials",
        "The reviewer ID or secret is incorrect.",
        401,
      );
    }
    const secret = process.env.REVIEWER_SESSION_SECRET?.trim() ?? "";
    const signed = signReviewerSession(body.data.reviewerId, secret);
    const response = NextResponse.json(
      {
        data: {
          reviewerId: signed.session.reviewerId,
          expiresAt: signed.session.expiresAt,
        },
      },
      { headers: NO_STORE },
    );
    setReviewerCookie(response, signed.value, signed.session.expiresAtMs);
    return response;
  } catch (error) {
    return errorResponse(
      "reviewer_auth_unavailable",
      error instanceof Error
        ? error.message
        : "Reviewer authentication is not configured correctly.",
      503,
    );
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return errorResponse(
      "invalid_origin",
      "Sign-out requests must come from the same origin.",
      403,
    );
  }
  const response = new NextResponse(null, { status: 204, headers: NO_STORE });
  clearReviewerCookie(response);
  return response;
}
