import { loadEnvConfig } from "@next/env";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { seedRegistry } from "@/lib/data/postgres/seed";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { GDELT_SPACING_MS } from "@/lib/ingestion/gdelt";
import { selectIngestionSources } from "@/lib/ingestion/sources";
import { PostgresSchedulerLease, runScheduledIngestion } from "@/lib/scheduler";
import type { ScheduledIngestionOutcome } from "@/lib/scheduler/types";
import { openDriver, resolveDatabaseUrl } from "../db/connection";
import { loadMigrationBundles } from "../db/load-migrations";

loadEnvConfig(process.cwd());

interface CliOptions {
  source: string;
  intervalMinutes: number;
  lockTtlSeconds: number;
  once: boolean;
  pglite: boolean;
  limit: number | null;
  json: boolean;
  help: boolean;
}

function envInteger(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const USAGE = `Nigeria State Monitor — ingestion scheduler

Usage:
  npm run scheduler -- [--once] [--pglite] [--source=all|slug,slug]
                      [--interval=15] [--lock-ttl=300] [--limit=20] [--json]

Options:
  --once               Run one ingestion attempt and exit (cron-style)
  --pglite             Use an ephemeral local PGlite/PostGIS database
  --source=<slugs>     One slug, a comma list, or "all" (default: INGESTION_SOURCE or all)
  --interval=<minutes> Delay between runs (1–1440, default: 15)
  --lock-ttl=<seconds> Database lease duration (30–3600, default: interval × 2)
  --limit=<n>          Examine at most n feed items
  --json               One JSON object per run
  --help               Show this help

Every run is protected by the scheduler_locks lease. Capture writes evidence
and review candidates only; no event is published by this command.
A normal run requires NSM_REPOSITORY=postgres, DATABASE_URL and a migrated database.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const intervalMinutes = envInteger("SCHEDULER_INTERVAL_MINUTES", 15, 1, 1_440);
  const defaultTtl = Math.min(3_600, Math.max(60, intervalMinutes * 60 * 2));
  const options: CliOptions = {
    source: process.env.INGESTION_SOURCE?.trim() || "all",
    intervalMinutes,
    lockTtlSeconds: envInteger("SCHEDULER_LOCK_TTL_SECONDS", defaultTtl, 30, 3_600),
    once: false,
    pglite: false,
    limit: null,
    json: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--once") options.once = true;
    else if (argument === "--pglite") options.pglite = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--source=")) {
      options.source = argument.slice("--source=".length).trim();
      if (!options.source) throw new Error("--source requires a slug.");
    } else if (argument.startsWith("--interval=")) {
      const raw = argument.slice("--interval=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--interval must be a positive integer.");
      options.intervalMinutes = Number.parseInt(raw, 10);
      if (options.intervalMinutes < 1 || options.intervalMinutes > 1_440) {
        throw new Error("--interval must be between 1 and 1440 minutes.");
      }
    } else if (argument.startsWith("--lock-ttl=")) {
      const raw = argument.slice("--lock-ttl=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--lock-ttl must be a positive integer.");
      options.lockTtlSeconds = Number.parseInt(raw, 10);
      if (options.lockTtlSeconds < 30 || options.lockTtlSeconds > 3_600) {
        throw new Error("--lock-ttl must be between 30 and 3600 seconds.");
      }
    } else if (argument.startsWith("--limit=")) {
      const raw = argument.slice("--limit=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--limit must be a positive integer.");
      options.limit = Number.parseInt(raw, 10);
      if (options.limit < 1) throw new Error("--limit must be at least 1.");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.lockTtlSeconds < 30 || options.lockTtlSeconds > 3_600) {
    throw new Error("--lock-ttl must be between 30 and 3600 seconds.");
  }
  return options;
}

function printRun(outcome: ScheduledIngestionOutcome, mode: "pglite" | "postgres"): void {
  if (outcome.status === "locked") {
    console.log(
      `[${new Date().toISOString()}] ${outcome.source}: another scheduler holds ${outcome.lockKey}; no request was made.`,
    );
    return;
  }
  const result = outcome.result;
  if (!result) {
    console.log(`[${new Date().toISOString()}] ${outcome.source}: no result.`);
    return;
  }
  const summary = result.summary;
  console.log(
    `[${new Date().toISOString()}] ${outcome.source} (${mode}): fetched ${summary.fetched}, accepted ${summary.accepted}, rejected ${summary.rejected}, candidates inserted ${summary.candidatesInserted}, status ${summary.status}`,
  );
  if (result.error) console.error(`  error: ${result.error}`);
  console.log("  No event was published; captured items are review candidates only.");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("");
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const sources = selectIngestionSources(options.source);
  for (const source of sources) {
    if (options.limit !== null && options.limit > source.maxItems) {
      throw new Error(
        `--limit=${options.limit} exceeds ${source.slug}'s configured maximum of ${source.maxItems}.`,
      );
    }
  }

  let driver: DatabaseDriver | null = null;
  let mode: "pglite" | "postgres" = "postgres";
  try {
    if (options.pglite) {
      const local = await PgliteDriver.create();
      driver = local;
      await applyMigrations(local, loadMigrationBundles());
      await local.transaction((tx) => seedRegistry(tx));
      mode = "pglite";
    } else {
      if (!resolveDatabaseUrl("admin")) {
        throw new Error(
          "A database URL is required for the scheduler. Set MIGRATION_DATABASE_URL or DATABASE_URL, or use --pglite for an ephemeral local run.",
        );
      }
      driver = openDriver("admin");
    }

    const store = new PostgresIngestionStore(driver);
    const lease = new PostgresSchedulerLease(driver);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    console.log("Nigeria State Monitor — ingestion scheduler");
    console.log(`Sources: ${sources.map((item) => item.slug).join(", ")}`);
    console.log(`Mode: ${mode}`);
    console.log(
      `Interval: ${options.intervalMinutes} minute(s) · lease ${options.lockTtlSeconds}s · ${options.once ? "single run" : "continuous"}`,
    );

    let failedOnce = false;
    while (!controller.signal.aborted) {
      let previousWasAggregator = false;
      for (const source of sources) {
      if (controller.signal.aborted) break;
      if (previousWasAggregator && source.accessMethod === "gdelt") await sleep(GDELT_SPACING_MS, controller.signal);
      previousWasAggregator = source.accessMethod === "gdelt";
      try {
        const outcome = await runScheduledIngestion({
          source,
          store,
          lease,
          lockKey: `ingest:${source.slug}`,
          lockTtlSeconds: options.lockTtlSeconds,
          limit: options.limit ?? undefined,
          contact: process.env.NSM_INGESTION_CONTACT,
        });
        if (options.json) {
          console.log(
            JSON.stringify({
              event: "scheduler.run",
              at: new Date().toISOString(),
              mode,
              status: outcome.status,
              source: outcome.source,
              lockKey: outcome.lockKey,
              summary: outcome.result?.summary ?? null,
              error: outcome.result?.error ?? null,
            }),
          );
        } else {
          printRun(outcome, mode);
        }
        if (outcome.result?.summary.status === "failed") failedOnce = true;
      } catch (error) {
        failedOnce = true;
        console.error(
          `[${new Date().toISOString()}] scheduler run failed:`,
          error instanceof Error ? error.message : error,
        );
      }
      }

      if (options.once || controller.signal.aborted) break;
      await sleep(options.intervalMinutes * 60_000, controller.signal);
    }

    if (options.once && failedOnce) process.exitCode = 1;
  } finally {
    if (driver) await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Scheduler failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
