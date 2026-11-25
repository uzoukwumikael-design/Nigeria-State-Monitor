import { loadEnvConfig } from "@next/env";
import { PostgresReviewStore } from "@/lib/data/postgres/review";
import { STATE_BY_ID } from "@/lib/geo/states";
import type { ReviewAction, ReviewCandidate, ReviewQueueFilter } from "@/lib/review/types";
import { CATEGORY_IDS, type Category } from "@/lib/types";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

loadEnvConfig(process.cwd());

interface CliOptions {
  list: boolean;
  id: string | null;
  action: ReviewAction | null;
  reviewerId: string | null;
  category: Category | null;
  stateId: string | null;
  notes: string | null;
  status: ReviewQueueFilter;
  limit: number;
  json: boolean;
  help: boolean;
}

const FILTERS: readonly ReviewQueueFilter[] = [
  "open",
  "pending",
  "needs_review",
  "accepted",
  "rejected",
];

const USAGE = `Nigeria State Monitor — reviewer workflow

Usage:
  npm run review -- --list [--status=open|pending|needs_review|accepted|rejected] [--limit=20] [--json]
  npm run review -- --id=<candidate> --action=accept|reject --reviewer=<id> [options]

Decision options:
  --category=<category>   Override the proposed category when accepting
  --state=NG-XX           Override the proposed state when accepting
  --notes="..."           Reviewer rationale; required for rejection (3–1000 chars)

Options:
  --json                  Machine-readable output
  --help                  Show this help

A reviewer ID is a stable operator identifier (3–64 lowercase letters, digits,
dots, underscores or hyphens), not a personal email address.

Acceptance records evidence review only. It never creates, updates or publishes
an event. No event publication or verification state machine exists yet.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    list: false,
    id: null,
    action: null,
    reviewerId: null,
    category: null,
    stateId: null,
    notes: null,
    status: "open",
    limit: 20,
    json: false,
    help: false,
  };

  let limitProvided = false;
  for (const argument of argv) {
    if (argument === "--list") options.list = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--id=")) options.id = argument.slice("--id=".length).trim() || null;
    else if (argument.startsWith("--reviewer=")) {
      options.reviewerId = argument.slice("--reviewer=".length).trim() || null;
    } else if (argument.startsWith("--notes=")) {
      options.notes = argument.slice("--notes=".length);
    } else if (argument.startsWith("--category=")) {
      const raw = argument.slice("--category=".length).trim().toLowerCase();
      if (!(CATEGORY_IDS as readonly string[]).includes(raw)) {
        throw new Error(`Unknown category: ${raw || "(empty)"}.`);
      }
      options.category = raw as Category;
    } else if (argument.startsWith("--state=")) {
      const raw = argument.slice("--state=".length).trim().toUpperCase();
      if (!raw || !STATE_BY_ID.has(raw)) {
        throw new Error(`Unknown state: ${raw || "(empty)"}. Use an NSM state ID such as NG-PL.`);
      }
      options.stateId = raw;
    } else if (argument.startsWith("--action=")) {
      const raw = argument.slice("--action=".length).trim().toLowerCase();
      if (raw !== "accept" && raw !== "reject") {
        throw new Error("--action must be accept or reject.");
      }
      options.action = raw;
    } else if (argument.startsWith("--status=")) {
      const raw = argument.slice("--status=".length).trim().toLowerCase();
      if (!FILTERS.includes(raw as ReviewQueueFilter)) {
        throw new Error("--status must be open, pending, needs_review, accepted or rejected.");
      }
      options.status = raw as ReviewQueueFilter;
    } else if (argument.startsWith("--limit=")) {
      limitProvided = true;
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

  if (options.help) return options;

  if (options.list) {
    if (
      options.id ||
      options.action ||
      options.reviewerId ||
      options.category ||
      options.stateId ||
      options.notes !== null
    ) {
      throw new Error("--list cannot be combined with a decision.");
    }
    return options;
  }

  if (!options.id) {
    throw new Error("Provide --list to inspect the queue or --id with --action to decide.");
  }
  if (!options.action) throw new Error("--action=accept|reject is required with --id.");
  if (!options.reviewerId) throw new Error("--reviewer is required with --id.");
  if (limitProvided) throw new Error("--limit is only valid with --list.");
  return options;
}

function short(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function displayDate(value: string | null): string {
  return value ? value.slice(0, 10) : "undated";
}

function serializeCandidate(candidate: ReviewCandidate) {
  return {
    id: candidate.publicId,
    status: candidate.status,
    category: candidate.category,
    stateId: candidate.stateId,
    lga: candidate.lga,
    categoryConfidence: candidate.categoryConfidence,
    geoConfidence: candidate.geoConfidence,
    reasons: candidate.reasons,
    ruleVersion: candidate.ruleVersion,
    createdAt: candidate.createdAt,
    reviewedAt: candidate.reviewedAt,
    reviewedBy: candidate.reviewedBy,
    article: {
      id: candidate.article.publicId,
      title: candidate.article.title,
      url: candidate.article.url,
      publishedAt: candidate.article.publishedAt,
      source: candidate.article.sourceName,
    },
  };
}

function printList(candidates: readonly ReviewCandidate[], options: CliOptions): void {
  console.log("Nigeria State Monitor — review queue");
  console.log("Mode: postgres");
  console.log(`Filter: ${options.status}`);
  console.log(`Shown: ${candidates.length} candidate(s), limit ${options.limit}`);
  if (candidates.length === 0) {
    console.log("No candidates matched.");
    return;
  }
  for (const candidate of candidates) {
    console.log(
      `${candidate.publicId} | ${candidate.status} | ${candidate.category ?? "unresolved"} | ` +
        `${candidate.stateId ?? "unresolved"} | ${displayDate(candidate.article.publishedAt)} | ` +
        short(candidate.article.title, 88),
    );
  }
  console.log("No event is published by this command. Candidates are evidence, not incidents.");
}

function printDecision(candidate: ReviewCandidate, reviewId: string, action: ReviewAction): void {
  console.log("Nigeria State Monitor — reviewer decision");
  console.log("Mode: postgres");
  console.log(`Candidate: ${candidate.publicId}`);
  console.log(`Source: ${candidate.article.sourceName}`);
  console.log(`Title: ${candidate.article.title}`);
  console.log(`Action: ${action}`);
  console.log(`Status: ${candidate.status}`);
  console.log(`Category: ${candidate.category ?? "unresolved"}`);
  console.log(`State: ${candidate.stateId ?? "unresolved"}`);
  console.log(`Reviewer: ${candidate.reviewedBy ?? "unknown"}`);
  console.log(`Decided at: ${candidate.reviewedAt ?? "unknown"}`);
  console.log(`Review audit: ${reviewId}`);
  console.log(
    "No event was published. Acceptance records evidence only; publication and verification are not implemented.",
  );
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
    console.error(
      "A database URL is required. Set MIGRATION_DATABASE_URL or DATABASE_URL; never expose it to the client.",
    );
    process.exitCode = 2;
    return;
  }

  const driver = openDriver("admin");
  try {
    const store = new PostgresReviewStore(driver);

    if (options.list) {
      const candidates = await store.listReviewQueue({
        status: options.status,
        limit: options.limit,
      });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              mode: "postgres",
              filter: options.status,
              shown: candidates.length,
              candidates: candidates.map(serializeCandidate),
            },
            null,
            2,
          ),
        );
      } else {
        printList(candidates, options);
      }
      return;
    }

    const result = await store.decide({
      candidatePublicId: options.id!,
      action: options.action!,
      reviewerId: options.reviewerId!,
      category: options.category,
      stateId: options.stateId,
      notes: options.notes,
    });

    if (!result.ok) {
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`Review failed [${result.code}]: ${result.message}`);
      }
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "postgres",
            action: options.action,
            reviewId: result.reviewId,
            candidate: serializeCandidate(result.candidate),
            published: false,
          },
          null,
          2,
        ),
      );
    } else {
      printDecision(result.candidate, result.reviewId, options.action!);
    }
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Review failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
