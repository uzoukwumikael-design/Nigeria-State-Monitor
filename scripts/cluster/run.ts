import { loadEnvConfig } from "@next/env";
import { PostgresClusterStore } from "@/lib/data/postgres/clusters";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import type {
  ClusterQueueStatus,
  ClusterReviewAction,
} from "@/lib/clustering/types";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

loadEnvConfig(process.cwd());

interface CliOptions {
  scan: boolean;
  list: boolean;
  status: ClusterQueueStatus;
  limit: number;
  id: string | null;
  action: ClusterReviewAction | null;
  reviewer: string | null;
  notes: string | null;
  json: boolean;
  help: boolean;
}

const STATUSES: readonly ClusterQueueStatus[] = ["pending", "accepted", "rejected", "all"];

const USAGE = `Nigeria State Monitor — cluster review

Usage:
  npm run cluster -- --scan [--limit=50] [--json]
  npm run cluster -- --list [--status=pending|accepted|rejected|all] [--limit=50] [--json]
  npm run cluster -- --id=<cluster> --action=accept|reject --reviewer=<id> --notes="..." [--json]

Options:
  --scan               Assess accepted candidates against published events
  --list               List recorded cluster assessments
  --status=<state>     Queue filter for --list (default: pending)
  --limit=<n>          Maximum rows (1–100)
  --id=<cluster>       Cluster UUID for a review decision
  --action=<action>    accept or reject
  --reviewer=<id>      Stable reviewer ID (3–64 lowercase characters)
  --notes="..."        Reviewer rationale (10–1000 characters)
  --json               Machine-readable output
  --help               Show this help

Accepting a cluster attaches the candidate article as supporting evidence. It
does not publish an event and does not change verification status. A similarity
score alone is never enough: the category, state and 72-hour gates run first.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    scan: false,
    list: false,
    status: "pending",
    limit: 50,
    id: null,
    action: null,
    reviewer: null,
    notes: null,
    json: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--scan") options.scan = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--status=")) {
      const value = argument.slice("--status=".length).trim() as ClusterQueueStatus;
      if (!STATUSES.includes(value)) {
        throw new Error(`--status must be one of: ${STATUSES.join(", ")}.`);
      }
      options.status = value;
    } else if (argument.startsWith("--limit=")) {
      const raw = argument.slice("--limit=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--limit must be a positive integer.");
      options.limit = Number.parseInt(raw, 10);
      if (options.limit < 1 || options.limit > 100) {
        throw new Error("--limit must be between 1 and 100.");
      }
    } else if (argument.startsWith("--id=")) {
      options.id = argument.slice("--id=".length).trim();
      if (!options.id) throw new Error("--id requires a cluster UUID.");
    } else if (argument.startsWith("--action=")) {
      const value = argument.slice("--action=".length).trim();
      if (value !== "accept" && value !== "reject") {
        throw new Error("--action must be accept or reject.");
      }
      options.action = value;
    } else if (argument.startsWith("--reviewer=")) {
      options.reviewer = argument.slice("--reviewer=".length).trim();
      if (!options.reviewer) throw new Error("--reviewer requires an ID.");
    } else if (argument.startsWith("--notes=")) {
      options.notes = argument.slice("--notes=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const modes = [options.scan, options.list, options.id !== null].filter(Boolean).length;
  if (modes !== 1) {
    throw new Error("Choose exactly one mode: --scan, --list or --id=<cluster>.");
  }
  if (options.id !== null) {
    if (!options.action) throw new Error("--action is required with --id.");
    if (!options.reviewer) throw new Error("--reviewer is required with --id.");
    if (options.notes === null) throw new Error("--notes is required with --id.");
  }
  return options;
}

function printQueue(items: Awaited<ReturnType<PostgresClusterStore["listQueue"]>>): void {
  console.log(`Clusters: ${items.length}`);
  for (const item of items) {
    const score = item.similarity == null ? "gated" : item.similarity.toFixed(3);
    console.log(
      `- ${item.id} [${item.decision}] score=${score} candidate=${item.candidate.publicId} event=${item.event.publicId}`,
    );
    console.log(`  candidate: ${item.candidate.title}`);
    console.log(`  event:     ${item.event.title}`);
    if (item.reviewedBy) console.log(`  reviewed by ${item.reviewedBy} at ${item.reviewedAt}`);
    for (const reason of item.reasons) console.log(`  reason: ${reason}`);
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
  if (!resolveDatabaseUrl("admin")) {
    throw new Error(
      "A database URL is required for cluster review. Set MIGRATION_DATABASE_URL or DATABASE_URL.",
    );
  }

  let driver: DatabaseDriver | null = null;
  try {
    driver = openDriver("admin");
    const store = new PostgresClusterStore(driver);

    if (options.scan) {
      const result = await store.scan(options.limit);
      console.log(JSON.stringify({ mode: "scan", ...result }, null, options.json ? 0 : 2));
      console.log("No event was published; accepted clusters attach supporting evidence only.");
      return;
    }

    if (options.list) {
      const items = await store.listQueue(options.status, options.limit);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              mode: "list",
              status: options.status,
              clusters: items,
            },
            null,
            2,
          ),
        );
      } else {
        console.log("Nigeria State Monitor — cluster queue");
        printQueue(items);
      }
      return;
    }

    const result = await store.review({
      clusterId: options.id as string,
      action: options.action as ClusterReviewAction,
      reviewerId: options.reviewer as string,
      notes: options.notes as string,
    });
    if (options.json) {
      console.log(JSON.stringify({ mode: "review", ...result }, null, 2));
    } else if (result.ok) {
      console.log(
        `Cluster ${result.clusterId} ${result.action}ed by reviewer; event ${result.eventPublicId}. Audit ${result.auditId}.`,
      );
      console.log(
        result.action === "accept"
          ? "Supporting evidence was attached. No event was published and verification was not changed."
          : "The pair was rejected; nothing was attached.",
      );
    } else {
      console.error(`Cluster review failed [${result.code}]: ${result.message}`);
    }
    if (!result.ok) process.exitCode = 1;
  } finally {
    if (driver) await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Cluster command failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
