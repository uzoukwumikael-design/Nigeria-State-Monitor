import { loadEnvConfig } from "@next/env";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { seedRegistry } from "@/lib/data/postgres/seed";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { runIngestion } from "@/lib/ingestion/pipeline";
import { sleep } from "@/lib/ingestion/batch";
import { GDELT_SPACING_MS } from "@/lib/ingestion/gdelt";
import { selectIngestionSources } from "@/lib/ingestion/sources";
import type { FeedCollection, IngestionRunSummary } from "@/lib/ingestion/types";
import { openDriver, resolveDatabaseUrl } from "../db/connection";
import { loadMigrationBundles } from "../db/load-migrations";

loadEnvConfig(process.cwd());

interface CliOptions {
  source: string;
  dryRun: boolean;
  pglite: boolean;
  limit: number | null;
  json: boolean;
  help: boolean;
}

const USAGE = `Nigeria State Monitor — RSS ingestion

Usage:
  npm run ingest -- --source=premium-times|punch,vanguard|all [--dry-run] [--pglite] [--limit=20] [--json]

Options:
  --source=<slugs>  One slug, a comma list, or "all" active sources (default: all).
                    Each source is checked against robots.txt first; a failing source never stops the others.
  --dry-run         Fetch and classify without writing to a database
  --pglite          Use an ephemeral local PGlite/PostGIS database, migrate it,
                    seed the state registry and persist the run there
  --limit=<n>       Examine at most n feed items (capped by the source config)
  --json            Print a machine-readable summary without article text
  --help            Show this help

A normal run (no --dry-run) writes to MIGRATION_DATABASE_URL or DATABASE_URL.
No run publishes an event: captured articles become review candidates only.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    source: "all",
    dryRun: false,
    pglite: false,
    limit: null,
    json: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--pglite") options.pglite = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--source=")) options.source = argument.slice("--source=".length).trim();
    else if (argument.startsWith("--limit=")) {
      const raw = argument.slice("--limit=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--limit must be a positive integer.");
      options.limit = Number.parseInt(raw, 10);
      if (options.limit < 1) throw new Error("--limit must be at least 1.");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.source) throw new Error("--source requires a slug.");
  if (options.dryRun && options.pglite) {
    throw new Error("--dry-run and --pglite are mutually exclusive: dry-run performs no writes.");
  }
  return options;
}

function rejectionCounts(collection: FeedCollection): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of collection.rejected) {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function printHuman(
  summary: IngestionRunSummary,
  mode: "dry-run" | "pglite" | "postgres",
  rejections: Record<string, number>,
): void {
  console.log("Nigeria State Monitor — RSS ingestion");
  console.log(`Source: ${summary.source}`);
  console.log(`Mode: ${mode}`);
  console.log(`Run: ${summary.runId}`);
  console.log(
    `Fetched: ${summary.fetched} (accepted ${summary.accepted}, rejected ${summary.rejected})`,
  );
  if (mode === "dry-run") {
    console.log(
      `Candidates (not persisted): ${summary.accepted} (${summary.pending} pending, ${summary.needsReview} needs review)`,
    );
  } else {
    console.log(
      `Articles: ${summary.articlesInserted} inserted, ${summary.articlesDuplicate} already present`,
    );
    console.log(
      `Candidates: ${summary.candidatesInserted} inserted (${summary.pending} pending, ${summary.needsReview} needs review), ${summary.candidatesExisting} already present`,
    );
  }
  const reasons = Object.entries(rejections);
  if (reasons.length > 0) {
    console.log(`Rejections: ${reasons.map(([reason, count]) => `${reason}=${count}`).join(", ")}`);
  }
  console.log(`Status: ${summary.status}`);
  if (summary.status === "success" || summary.status === "partial") {
    console.log("No event was published. Review candidates are evidence, not incidents.");
  }
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
  let mode: "dry-run" | "pglite" | "postgres" = "dry-run";
  let store: PostgresIngestionStore | undefined;

  try {
    if (options.pglite) {
      const local = await PgliteDriver.create();
      driver = local;
      await applyMigrations(local, loadMigrationBundles());
      await local.transaction((tx) => seedRegistry(tx));
      store = new PostgresIngestionStore(local);
      mode = "pglite";
    } else if (!options.dryRun) {
      if (!resolveDatabaseUrl("admin")) {
        throw new Error(
          "A database URL is required for a persistent run. Set MIGRATION_DATABASE_URL or DATABASE_URL, " +
            "or use --pglite for an ephemeral local run, or --dry-run for no writes.",
        );
      }
      const remote = openDriver("admin");
      driver = remote;
      store = new PostgresIngestionStore(remote);
      mode = "postgres";
    }

    const results: Array<{ result: Awaited<ReturnType<typeof runIngestion>>; rejections: Record<string, number> }> = [];
    let previousWasAggregator = false;
    for (const source of sources) {
      // GDELT asks for at most one request every 5 seconds.
      if (previousWasAggregator && source.accessMethod === "gdelt") await sleep(GDELT_SPACING_MS);
      previousWasAggregator = source.accessMethod === "gdelt";
      const result = await runIngestion({
        source,
        limit: options.limit ?? undefined,
        dryRun: options.dryRun,
        store,
      });
      results.push({ result, rejections: result.collection ? rejectionCounts(result.collection) : {} });
      if (!options.json) {
        if (sources.length > 1) console.log(`\n── ${source.name} ──`);
        printHuman(result.summary, mode, results.at(-1)!.rejections);
        if (result.error) console.error(`Error: ${result.error}`);
      }
    }

    if (options.json) {
      const entries = results.map(({ result, rejections }) => ({
        ...result.summary,
        mode,
        rejections,
        robots: result.robots ? { allowed: result.robots.allowed, reason: result.robots.reason } : null,
        error: result.error,
      }));
      console.log(
        JSON.stringify(
          sources.length === 1
            ? entries[0]
            : {
                mode,
                sources: entries,
                totals: {
                  sources: entries.length,
                  succeeded: entries.filter((entry) => entry.status !== "failed").length,
                  failed: entries.filter((entry) => entry.status === "failed").length,
                  fetched: entries.reduce((sum, entry) => sum + entry.fetched, 0),
                  candidatesInserted: entries.reduce((sum, entry) => sum + entry.candidatesInserted, 0),
                },
              },
          null,
          2,
        ),
      );
    } else if (sources.length > 1) {
      const failed = results.filter(({ result }) => result.summary.status === "failed");
      console.log(`\nSummary: ${results.length - failed.length} of ${results.length} sources succeeded.`);
      for (const { result } of failed) console.log(`  failed: ${result.summary.source} — ${result.error}`);
    }

    // One broken publisher must not turn a healthy multi-source run into a failure.
    const allFailed = results.every(({ result }) => result.error || result.summary.status === "failed");
    if (allFailed) process.exitCode = 1;
  } finally {
    if (driver) await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Ingestion failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
