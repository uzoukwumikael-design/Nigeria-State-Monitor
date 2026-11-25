import { loadEnvConfig } from "@next/env";
import { PostgresVerificationStore } from "@/lib/data/postgres/verification";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { MAX_VERIFICATION_RATIONALE, MIN_VERIFICATION_RATIONALE } from "@/lib/verification";
import { VERIFICATION_STATUSES, type VerificationStatus } from "@/lib/types";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

loadEnvConfig(process.cwd());

interface CliOptions {
  list: boolean;
  id: string | null;
  target: VerificationStatus | null;
  reviewer: string | null;
  rationale: string | null;
  approveCorroboration: boolean;
  limit: number;
  json: boolean;
  help: boolean;
}

const TARGETS: readonly VerificationStatus[] = VERIFICATION_STATUSES.filter(
  (status) => status !== "unassessed",
);

const USAGE = `Nigeria State Monitor — verification transitions

Usage:
  npm run verification -- --list [--limit=50] [--json]
  npm run verification -- --id=<event> --target=<status> --reviewer=<id> --rationale="..." [--approve-corroboration] [--json]

Options:
  --list                   List published production events and their current status
  --id=<event>             Event public ID
  --target=<status>        ${TARGETS.join(" | ")}
  --reviewer=<id>          Stable reviewer ID (3–64 lowercase characters)
  --rationale="..."        Evidence rationale (${MIN_VERIFICATION_RATIONALE}–${MAX_VERIFICATION_RATIONALE} characters)
  --approve-corroboration  Required for target=corroborated
  --limit=<n>              Maximum rows for --list (1–100)
  --json                   Machine-readable output
  --help                   Show this help

The state machine, not this CLI, decides what is allowed. Independent source
groups drive multiple_sources and corroborated; article count does not.
Retracted is terminal. No event is created or published by this command.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    list: false,
    id: null,
    target: null,
    reviewer: null,
    rationale: null,
    approveCorroboration: false,
    limit: 50,
    json: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--list") options.list = true;
    else if (argument === "--approve-corroboration") options.approveCorroboration = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--id=")) options.id = argument.slice("--id=".length).trim() || null;
    else if (argument.startsWith("--target=")) {
      const value = argument.slice("--target=".length).trim() as VerificationStatus;
      if (!TARGETS.includes(value)) {
        throw new Error(`--target must be one of: ${TARGETS.join(", ")}.`);
      }
      options.target = value;
    } else if (argument.startsWith("--reviewer=")) {
      options.reviewer = argument.slice("--reviewer=".length).trim() || null;
    } else if (argument.startsWith("--rationale=")) {
      options.rationale = argument.slice("--rationale=".length);
    } else if (argument.startsWith("--limit=")) {
      const raw = argument.slice("--limit=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--limit must be a positive integer.");
      options.limit = Number.parseInt(raw, 10);
      if (options.limit < 1 || options.limit > 100) {
        throw new Error("--limit must be between 1 and 100.");
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.list === (options.id !== null)) {
    throw new Error("Choose exactly one mode: --list or --id=<event>.");
  }
  if (options.id !== null) {
    if (!options.target) throw new Error("--target is required with --id.");
    if (!options.reviewer) throw new Error("--reviewer is required with --id.");
    if (options.rationale === null) throw new Error("--rationale is required with --id.");
    if (options.approveCorroboration && options.target !== "corroborated") {
      throw new Error("--approve-corroboration is only valid with --target=corroborated.");
    }
  }
  return options;
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
  if (!resolveDatabaseUrl("admin")) {
    throw new Error(
      "A database URL is required for verification. Set MIGRATION_DATABASE_URL or DATABASE_URL.",
    );
  }

  let driver: DatabaseDriver | null = null;
  try {
    driver = openDriver("admin");
    const store = new PostgresVerificationStore(driver);

    if (options.list) {
      const events = await store.listEvents(options.limit);
      if (options.json) {
        console.log(JSON.stringify({ mode: "list", events }, null, 2));
      } else {
        console.log("Nigeria State Monitor — verification queue");
        console.log(`Published events: ${events.length}`);
        for (const event of events) {
          console.log(
            `- ${event.eventPublicId} [${event.verificationStatus}] severity=${event.severity} state=${event.stateId ?? "national"} · ${event.title}`,
          );
          console.log(
            `  articles=${event.articleCount} independent groups=${event.independentSourceCount} conflicts=${event.conflictGroups} retractions=${event.retractedCount}`,
          );
          console.log(`  allowed targets: ${event.allowedTargets.join(", ") || "none (terminal)"}`);
        }
      }
      return;
    }

    const result = await store.transition({
      eventPublicId: options.id as string,
      target: options.target as VerificationStatus,
      reviewerId: options.reviewer as string,
      rationale: options.rationale as string,
      approveCorroboration: options.approveCorroboration,
    });
    if (options.json) {
      console.log(JSON.stringify({ mode: "transition", ...result }, null, 2));
    } else if (result.ok) {
      console.log(
        `${result.transition.eventPublicId}: ${result.transition.previousStatus} → ${result.transition.status}`,
      );
      console.log(result.transition.description);
      console.log(`Timeline ${result.updateId} · audit ${result.auditId}`);
      console.log("No event was created or published by this transition.");
    } else {
      console.error(`Verification failed [${result.code}]: ${result.message}`);
    }
    if (!result.ok) process.exitCode = 1;
  } finally {
    if (driver) await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Verification command failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
