import { loadEnvConfig } from "@next/env";
import { PostgresPublicationStore } from "@/lib/data/postgres/publication";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { MAX_PUBLICATION_RATIONALE, MIN_PUBLICATION_RATIONALE } from "@/lib/publication";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

loadEnvConfig(process.cwd());

interface CliOptions {
  list: boolean;
  id: string | null;
  severity: number | null;
  rationale: string | null;
  reviewer: string | null;
  limit: number;
  json: boolean;
  help: boolean;
}

const USAGE = `Nigeria State Monitor — publish an accepted candidate

Usage:
  npm run publish -- --list [--limit=50] [--json]
  npm run publish -- --id=<candidate> --severity=<1-5> --rationale="..." --reviewer=<id> [--json]

Options:
  --list               List accepted candidates with no event outcome
  --id=<candidate>     Candidate public ID to publish
  --severity=<1-5>     Reviewer-supplied severity
  --rationale="..."    Severity rationale (${MIN_PUBLICATION_RATIONALE}–${MAX_PUBLICATION_RATIONALE} characters)
  --reviewer=<id>      Stable reviewer ID (3–64 lowercase characters)
  --limit=<n>          Maximum rows for --list (1–100)
  --json               Machine-readable output
  --help               Show this help

Publication creates one production event from accepted evidence, its primary
source link, an immutable candidate link, a timeline entry, an audit row and a
new production dataset snapshot. Verification is set to unassessed; publication
does not claim that an event is true.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    list: false,
    id: null,
    severity: null,
    rationale: null,
    reviewer: null,
    limit: 50,
    json: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--list") options.list = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--id=")) options.id = argument.slice("--id=".length).trim() || null;
    else if (argument.startsWith("--severity=")) {
      const raw = argument.slice("--severity=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--severity must be an integer from 1 to 5.");
      options.severity = Number.parseInt(raw, 10);
      if (options.severity < 1 || options.severity > 5) {
        throw new Error("--severity must be an integer from 1 to 5.");
      }
    } else if (argument.startsWith("--rationale=")) {
      options.rationale = argument.slice("--rationale=".length);
    } else if (argument.startsWith("--reviewer=")) {
      options.reviewer = argument.slice("--reviewer=".length).trim() || null;
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
    throw new Error("Choose exactly one mode: --list or --id=<candidate>.");
  }
  if (options.id !== null) {
    if (options.severity === null) throw new Error("--severity is required with --id.");
    if (options.rationale === null) throw new Error("--rationale is required with --id.");
    if (!options.reviewer) throw new Error("--reviewer is required with --id.");
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
      "A database URL is required for publication. Set MIGRATION_DATABASE_URL or DATABASE_URL; publication never happens in memory.",
    );
  }

  let driver: DatabaseDriver | null = null;
  try {
    driver = openDriver("admin");
    const store = new PostgresPublicationStore(driver);

    if (options.list) {
      const candidates = await store.listPublishable(options.limit);
      if (options.json) {
        console.log(JSON.stringify({ mode: "list", candidates }, null, 2));
      } else {
        console.log("Nigeria State Monitor — publishable candidates");
        console.log(`Candidates: ${candidates.length}`);
        for (const candidate of candidates) {
          console.log(
            `- ${candidate.publicId} [${candidate.category}] ${candidate.stateName} (${candidate.stateId}) · ${candidate.sourceName}`,
          );
          console.log(`  ${candidate.title}`);
          if (candidate.reviewedBy) {
            console.log(`  accepted by ${candidate.reviewedBy} at ${candidate.reviewedAt}`);
          }
        }
      }
      return;
    }

    const result = await store.publish({
      candidatePublicId: options.id as string,
      reviewerId: options.reviewer as string,
      severity: options.severity as number,
      severityRationale: options.rationale as string,
    });
    if (options.json) {
      console.log(JSON.stringify({ mode: "publish", ...result }, null, 2));
    } else if (result.ok) {
      console.log(`Published event ${result.event.eventPublicId} (${result.event.eventSlug})`);
      console.log(`State: ${result.event.stateId} · category: ${result.event.category} · severity: ${result.event.severity}`);
      console.log(`Verification: ${result.event.verificationStatus}`);
      console.log(`Snapshot: ${result.snapshotVersion}`);
      console.log(`Link: ${result.linkId} · audit: ${result.auditId}`);
      console.log("The event is production data. Verification is unassessed until a reviewer records a transition.");
    } else {
      console.error(`Publication failed [${result.code}]: ${result.message}`);
    }
    if (!result.ok) process.exitCode = 1;
  } finally {
    if (driver) await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Publication failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
