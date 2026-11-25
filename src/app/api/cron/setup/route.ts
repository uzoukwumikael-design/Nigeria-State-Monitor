import { NextResponse, type NextRequest } from "next/server";
import { getPostgresDriver } from "@/lib/data/postgres/client";
import { loadMigrationBundles } from "@/lib/data/postgres/load-migrations";
import { authorizeCronRequest, configuredCronSecret } from "@/lib/scheduler/auth";
import { evaluateGoLiveEnv } from "@/lib/setup/golive";
import { runSetup } from "@/lib/setup/run-setup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/**
 * One-call database setup for deployments without a terminal. Protected by the same CRON_SECRET bearer token as
 * the other scheduled endpoints. Applies pending migrations in order and seeds the 37-state registry; running it
 * again is safe. `?dry=1` only reports what is pending. Prefer a direct or session-pooled connection in
 * MIGRATION_DATABASE_URL: transaction poolers can reject some migration statements.
 */
async function handler(request: NextRequest): Promise<NextResponse> {
  const id = `setup_${crypto.randomUUID()}`;
  const configured = configuredCronSecret();
  if (!configured.ok) {
    return reply({ error: { code: "SETUP_NOT_CONFIGURED", message: configured.message }, requestId: id }, 503);
  }
  if (!authorizeCronRequest(request.headers).ok) {
    return reply(
      { error: { code: "UNAUTHORISED", message: "A valid CRON_SECRET bearer token is required." }, requestId: id },
      401,
      { "www-authenticate": "Bearer" },
    );
  }
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return reply(
      { error: { code: "SETUP_NOT_CONFIGURED", message: "Set DATABASE_URL (and preferably MIGRATION_DATABASE_URL) first." }, requestId: id },
      503,
    );
  }
  try {
    const log: string[] = [];
    const summary = await runSetup(getPostgresDriver(databaseUrl), loadMigrationBundles(process.cwd()), {
      dryRun: request.nextUrl.searchParams.get("dry") === "1",
      log: (message) => log.push(message),
    });
    // The configuration review lists missing settings by name; it never echoes secret values.
    return reply(
      {
        status: summary.dryRun ? "dry_run" : summary.ready ? "ready" : "incomplete",
        ...summary,
        log,
        configuration: evaluateGoLiveEnv(process.env),
        requestId: id,
      },
      200,
    );
  } catch (error) {
    console.error("setup_error", error);
    return reply(
      {
        error: {
          code: "SETUP_FAILED",
          // The message is shown to the owner holding the secret; it names the failing migration or connection problem.
          message: error instanceof Error ? error.message.slice(0, 400) : "Setup failed.",
        },
        requestId: id,
      },
      500,
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handler(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handler(request);
}
