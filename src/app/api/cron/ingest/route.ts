import { NextResponse, type NextRequest } from "next/server";
import { getPostgresDriver } from "@/lib/data/postgres/client";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { executeAutopilot } from "@/lib/autopilot/execute";
import { pickWindow, rotate, runInBatches, sleep } from "@/lib/ingestion/batch";
import { GDELT_SPACING_MS } from "@/lib/ingestion/gdelt";
import { circuitState } from "@/lib/ingestion/circuit";
import { selectIngestionSources } from "@/lib/ingestion/sources";
import { authorizeCronRequest, configuredCronSecret } from "@/lib/scheduler/auth";
import { PostgresSchedulerLease, runScheduledIngestion } from "@/lib/scheduler/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Start no new publisher after this many ms; the platform limit is 60 s. */
const SOURCE_TIME_BUDGET_MS = 35_000;
/** Publishers fetched at the same time (each is a different host). */
const SOURCE_CONCURRENCY = 4;
/** GDELT queries executed per invocation (see the scheduling note below). */
const GDELT_PER_RUN = 2;
/** After ingesting, publishing may use the remaining time up to this point. */
const TOTAL_TIME_BUDGET_MS = 55_000;

function requestId(): string {
  return `cron_${crypto.randomUUID()}`;
}

function envelope(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function lockTtlSeconds(): number {
  const raw = process.env.SCHEDULER_LOCK_TTL_SECONDS?.trim();
  if (!raw) return 300;
  if (!/^\d+$/.test(raw)) {
    throw new Error("SCHEDULER_LOCK_TTL_SECONDS must be an integer between 30 and 3600.");
  }
  const value = Number.parseInt(raw, 10);
  if (value < 30 || value > 3_600) {
    throw new Error("SCHEDULER_LOCK_TTL_SECONDS must be an integer between 30 and 3600.");
  }
  return value;
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const id = requestId();
  const configured = configuredCronSecret();
  if (!configured.ok) {
    return envelope(
      { error: { code: "SCHEDULER_NOT_CONFIGURED", message: configured.message }, requestId: id },
      503,
    );
  }

  const authorization = authorizeCronRequest(request.headers);
  if (!authorization.ok) {
    return envelope(
      {
        error: {
          code: "UNAUTHORISED",
          message: "A valid CRON_SECRET bearer token is required.",
        },
        requestId: id,
      },
      401,
      { "www-authenticate": "Bearer" },
    );
  }

  if (process.env.NSM_REPOSITORY?.trim().toLowerCase() !== "postgres") {
    return envelope(
      {
        error: {
          code: "SCHEDULER_NOT_CONFIGURED",
          message: "Scheduled ingestion requires NSM_REPOSITORY=postgres.",
        },
        requestId: id,
      },
      503,
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return envelope(
      {
        error: {
          code: "SCHEDULER_NOT_CONFIGURED",
          message: "Scheduled ingestion requires a server-side DATABASE_URL.",
        },
        requestId: id,
      },
      503,
    );
  }

  // A comma list or "all"; ?source= lets one scheduler entry per publisher spread the load.
  const selection =
    request.nextUrl.searchParams.get("source")?.trim() ||
    process.env.INGESTION_SOURCE?.trim() ||
    "all";
  let sources;
  try {
    sources = selectIngestionSources(selection);
  } catch (error) {
    return envelope(
      {
        error: {
          code: "UNKNOWN_SOURCE",
          message: error instanceof Error ? error.message : "Unknown ingestion source.",
        },
        requestId: id,
      },
      500,
    );
  }

  try {
    const driver = getPostgresDriver(databaseUrl);
    const store = new PostgresIngestionStore(driver);
    const lease = new PostgresSchedulerLease(driver);
    const ttl = lockTtlSeconds();
    const startedAt = Date.now();
    const deadline = startedAt + SOURCE_TIME_BUDGET_MS;

    // Different publishers are different hosts, so a few can run at once. The start position rotates every
    // minute so that, if the time budget cuts a run short, the same publishers are not always the ones left out.
    // A feed that keeps failing is paused (30 min, doubling to 24 h) so it stops wasting run time; the next
    // trial happens automatically when the pause ends.
    const health = await store.listSourceHealth();
    const paused: Array<Record<string, unknown>> = [];
    const runnable = sources.filter((source) => {
      const record = health.get(source.slug);
      const state = circuitState({ consecutiveFailures: record?.consecutiveFailures ?? 0, lastCheckedAt: record?.lastCheckedAt ?? null });
      if (!state.open) return true;
      paused.push({
        source: source.slug,
        status: "paused",
        retryAt: state.retryAt,
        consecutiveFailures: record?.consecutiveFailures,
        lastError: record?.lastError,
      });
      return false;
    });
    // GDELT is one API that asks for a request every 5 seconds, so its queries cannot run in parallel and only
    // two run per invocation, walking through the list on successive runs (each query hourly at a 15-minute cadence).
    const feedSources = runnable.filter((source) => source.accessMethod !== "gdelt");
    const aggregatorSources = runnable.filter((source) => source.accessMethod === "gdelt");
    const aggregatorTurn = pickWindow(aggregatorSources, Math.floor(Date.now() / (15 * 60_000)), GDELT_PER_RUN);
    const aggregatorLater = aggregatorSources.filter((source) => !aggregatorTurn.includes(source)).map((source) => source.slug);

    const runOne = async (source: (typeof sources)[number]): Promise<Record<string, unknown>> => {
      // One publisher failing (robots, network, bad feed) never stops the others.
      try {
        const run = await runScheduledIngestion({
          source,
          store,
          lease,
          lockKey: `ingest:${source.slug}`,
          lockTtlSeconds: ttl,
          contact: process.env.NSM_INGESTION_CONTACT,
        });
        if (run.status === "locked") {
          return {
            source: source.slug,
            status: "locked",
            message: "Another scheduler holds the ingestion lease; this invocation made no request.",
          };
        }
        if (run.result) {
          return {
            source: source.slug,
            status: run.result.summary.status,
            summary: run.result.summary,
            robots: run.result.robots
              ? { allowed: run.result.robots.allowed, reason: run.result.robots.reason }
              : null,
            error: run.result.error,
          };
        }
        return { source: source.slug, status: "failed", error: "The ingestion result is missing." };
      } catch (error) {
        console.error("cron_ingest_source_error", source.slug, error);
        return { source: source.slug, status: "failed", error: "The run for this source failed." };
      }
    };

    const ordered = rotate(feedSources, Math.floor(Date.now() / 60_000));
    const outcome = await runInBatches(ordered, SOURCE_CONCURRENCY, runOne, () => Date.now() > deadline);
    for (const source of aggregatorTurn) {
      if (Date.now() > deadline) {
        outcome.skipped.push(source);
        continue;
      }
      if (outcome.results.length > 0 && aggregatorTurn.indexOf(source) > 0) await sleep(GDELT_SPACING_MS);
      outcome.results.push(await runOne(source));
    }
    const results = [...outcome.results, ...paused];
    const deferred = outcome.skipped.map((source) => source.slug);

    // One scheduler entry does everything: after ingesting, classify and publish automatically
    // (unless AUTOPUBLISH=off or ?autopilot=0). A failure here never hides the ingestion result.
    let publishing: unknown = { skipped: true, reason: "?autopilot=0" };
    if (request.nextUrl.searchParams.get("autopilot") !== "0") {
      try {
        publishing = await executeAutopilot(driver, { deadlineMs: startedAt + TOTAL_TIME_BUDGET_MS });
      } catch (error) {
        console.error("cron_ingest_autopilot_error", error);
        publishing = { error: "The automatic publishing step failed; ingestion results are unaffected." };
      }
    }

    if (sources.length === 1 && deferred.length === 0) {
      // Backwards-compatible single-source shape.
      return envelope({ ...results[0], publishing, requestId: id }, 200);
    }
    return envelope(
      {
        status: results.every((entry) => entry.status === "failed") ? "failed" : "completed",
        sources: results,
        deferred,
        // GDELT queries that were not this run's turn; they run on later invocations.
        aggregatorsLater: aggregatorLater,
        publishing,
        requestId: id,
      },
      200,
    );
  } catch (error) {
    console.error("cron_ingest_error", error);
    return envelope(
      {
        error: {
          code: "INGESTION_FAILED",
          message: "The scheduled ingestion run failed. No event was published.",
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
