import { NextResponse, type NextRequest } from "next/server";
import { executeAutopilot } from "@/lib/autopilot/execute";
import { getPostgresDriver } from "@/lib/data/postgres/client";
import { authorizeCronRequest, configuredCronSecret } from "@/lib/scheduler/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Leave headroom under the 60 s platform limit. */
const TIME_BUDGET_MS = 50_000;

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const id = `cron_${crypto.randomUUID()}`;
  const configured = configuredCronSecret();
  if (!configured.ok) {
    return reply({ error: { code: "SCHEDULER_NOT_CONFIGURED", message: configured.message }, requestId: id }, 503);
  }
  if (!authorizeCronRequest(request.headers).ok) {
    return reply(
      { error: { code: "UNAUTHORISED", message: "A valid CRON_SECRET bearer token is required." }, requestId: id },
      401,
      { "www-authenticate": "Bearer" },
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (process.env.NSM_REPOSITORY?.trim().toLowerCase() !== "postgres" || !databaseUrl) {
    return reply(
      { error: { code: "SCHEDULER_NOT_CONFIGURED", message: "Autopublishing requires NSM_REPOSITORY=postgres and DATABASE_URL." }, requestId: id },
      503,
    );
  }
  try {
    const result = await executeAutopilot(getPostgresDriver(databaseUrl), { deadlineMs: Date.now() + TIME_BUDGET_MS });
    return reply({ status: "completed", ...result, requestId: id }, 200);
  } catch (error) {
    console.error("cron_autopilot_error", error);
    return reply({ error: { code: "AUTOPILOT_FAILED", message: "The automatic publishing run failed." }, requestId: id }, 500);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handler(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handler(request);
}
