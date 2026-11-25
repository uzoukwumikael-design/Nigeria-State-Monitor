import { loadEnvConfig } from "@next/env";
import { AiConfigurationError, resolveEnrichmentProvider } from "@/lib/ai/provider";
import { runEnrichment } from "@/lib/ai/runner";
import { PostgresEnrichmentStore } from "@/lib/data/postgres/ai";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import type { EnrichmentCandidate, EnrichmentProvider, EnrichmentRunResult } from "@/lib/ai/types";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

loadEnvConfig(process.cwd());

interface CliOptions {
  list: boolean;
  candidate: string | null;
  limit: number;
  json: boolean;
  help: boolean;
}

const USAGE = `Nigeria State Monitor — AI enrichment

Usage:
  npm run enrich -- --list [--limit=20] [--json]
  npm run enrich -- --candidate=<candidate> [--json]
  npm run enrich -- [--limit=20] [--json]

Options:
  --list               List pending candidates without calling a model
  --candidate=<id>     Enrich one candidate by public ID
  --limit=<n>          Enrich at most n candidates (1–100, default 20)
  --json               Machine-readable summary without article text
  --help               Show this help

The provider defaults to disabled. A run requires AI_PROVIDER=openai-compatible|openai,
AI_API_KEY, AI_MODEL and, for a compatible endpoint, AI_BASE_URL.
A model only produces a validated proposal; it never changes a candidate or event.`;

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    list: false,
    candidate: null,
    limit: 20,
    json: false,
    help: false,
  };

  for (const argument of argv) {
    if (argument === "--list") options.list = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--candidate=")) {
      const value = argument.slice("--candidate=".length).trim();
      if (!value) throw new Error("--candidate requires a candidate public ID.");
      options.candidate = value;
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

  if (options.list && options.candidate) {
    throw new Error("--list and --candidate are mutually exclusive.");
  }
  return options;
}

function outcomeFailed(result: EnrichmentRunResult): boolean {
  return result.status === "provider_error" || result.status === "invalid";
}

function printHuman(
  candidates: EnrichmentCandidate[],
  results: Array<{ publicId: string; result: EnrichmentRunResult }>,
  mode: "list" | "run",
): void {
  console.log("Nigeria State Monitor — AI enrichment");
  console.log(`Mode: ${mode}`);
  console.log(`Candidates: ${candidates.length}`);
  for (const candidate of candidates) {
    console.log(
      `- ${candidate.publicId} [${candidate.status}] ${candidate.article.sourceName}: ${candidate.article.title.slice(0, 100)}`,
    );
  }
  if (mode === "run") {
    for (const entry of results) {
      const result = entry.result;
      const detail =
        result.status === "stored"
          ? `stored (${result.duplicate ? "duplicate" : "new"}) provider=${result.provider} model=${result.metadata.model}`
          : result.status === "invalid"
            ? `invalid code=${result.code} provider=${result.provider}`
            : result.status === "provider_error"
              ? `provider_error provider=${result.provider}`
              : result.status === "skipped"
                ? `skipped code=${result.code}`
                : `disabled provider=${result.provider}`;
      console.log(`- ${entry.publicId}: ${detail}`);
      if (result.status === "provider_error" || result.status === "invalid") {
        console.log(`  ${result.message}`);
      }
    }
  }
  if (mode === "list") {
    console.log("No model call was made.");
  } else {
    console.log("No candidate or event was modified; proposals are stored for reviewer use.");
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
      "A database URL is required. Set MIGRATION_DATABASE_URL or DATABASE_URL; AI proposals are never stored in memory.",
    );
  }

  let provider: EnrichmentProvider;
  try {
    provider = resolveEnrichmentProvider();
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      console.error(`AI configuration error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  let driver: DatabaseDriver | null = null;
  try {
    driver = openDriver("admin");
    const store = new PostgresEnrichmentStore(driver);

    if (options.list) {
      const candidates = await store.listCandidates(options.limit);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              mode: "list",
              provider: provider.id,
              enabled: provider.enabled,
              candidates: candidates.map((candidate) => ({
                publicId: candidate.publicId,
                status: candidate.status,
                category: candidate.category,
                stateId: candidate.stateId,
                source: candidate.article.sourceSlug,
              })),
            },
            null,
            2,
          ),
        );
      } else {
        printHuman(candidates, [], "list");
      }
      return;
    }

    if (!provider.enabled) {
      console.error(
        "AI enrichment is disabled. Set AI_PROVIDER=openai-compatible|openai and the required AI_* server variables; no model call was made.",
      );
      process.exitCode = 2;
      return;
    }

    let candidates: EnrichmentCandidate[];
    if (options.candidate) {
      const candidate = await store.candidate(options.candidate);
      if (!candidate) {
        throw new Error(`No production candidate with public ID ${options.candidate}.`);
      }
      if (candidate.status === "rejected") {
        throw new Error(`Candidate ${candidate.publicId} is rejected and cannot be enriched.`);
      }
      candidates = [candidate];
    } else {
      candidates = await store.listCandidates(options.limit);
    }

    const results: Array<{ publicId: string; result: EnrichmentRunResult }> = [];
    for (const candidate of candidates) {
      try {
        const result = await runEnrichment({ provider, candidate, store });
        results.push({ publicId: candidate.publicId, result });
      } catch (error) {
        results.push({
          publicId: candidate.publicId,
          result: {
            status: "provider_error",
            provider: provider.id,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            mode: "run",
            provider: provider.id,
            model: provider.model,
            candidates: candidates.length,
            stored: results.filter((entry) => entry.result.status === "stored").length,
            invalid: results.filter((entry) => entry.result.status === "invalid").length,
            providerErrors: results.filter((entry) => entry.result.status === "provider_error")
              .length,
            skipped: results.filter((entry) => entry.result.status === "skipped").length,
            results: results.map((entry) => {
              const result = entry.result;
              return {
                publicId: entry.publicId,
                status: result.status,
                ...(result.status === "stored"
                  ? {
                      enrichmentId: result.enrichmentId,
                      duplicate: result.duplicate,
                      hash: result.metadata.rawResponseHash,
                    }
                  : result.status === "invalid" || result.status === "skipped"
                    ? { code: result.code, message: result.message }
                    : result.status === "provider_error"
                      ? { message: result.message }
                      : {}),
              };
            }),
          },
          null,
          2,
        ),
      );
    } else {
      printHuman(candidates, results, "run");
    }

    if (results.some((entry) => outcomeFailed(entry.result))) {
      process.exitCode = 1;
    }
  } finally {
    if (driver) await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("AI enrichment failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
