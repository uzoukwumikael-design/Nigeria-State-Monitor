import { resolveEnrichmentProvider } from "@/lib/ai/provider";
import { enrichPending, type EnrichPendingSummary } from "@/lib/autopilot/enrich";
import { runAutopilot, type AutopilotSummary } from "@/lib/autopilot/run";
import { autopilotConfigFromEnv } from "@/lib/autopilot/rules";
import { PostgresProposalReader } from "@/lib/data/postgres/autopilot";
import { PostgresEnrichmentStore } from "@/lib/data/postgres/ai";
import { PostgresClusterStore } from "@/lib/data/postgres/clusters";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { PostgresPublicationStore } from "@/lib/data/postgres/publication";
import { PostgresReviewStore } from "@/lib/data/postgres/review";

export interface AutopilotRunResult {
  enrichment: EnrichPendingSummary | { enabled: false; error: string };
  autopilot: AutopilotSummary;
}

type Env = Record<string, string | undefined>;

/**
 * The whole hands-off step: ask the AI model (when one is configured) to classify new articles, then accept,
 * de-duplicate and publish. A misconfigured AI provider is reported and skipped; publishing still runs on the
 * rule-based classifier. `AUTOPUBLISH=off` stops everything here.
 */
export async function executeAutopilot(
  driver: DatabaseDriver,
  options: { deadlineMs?: number; env?: Env } = {},
): Promise<AutopilotRunResult> {
  const env = options.env ?? process.env;
  const config = autopilotConfigFromEnv(env);

  let enrichment: AutopilotRunResult["enrichment"];
  if (!config.enabled) {
    enrichment = { enabled: false, error: "AUTOPUBLISH is off." };
  } else {
    try {
      const provider = resolveEnrichmentProvider(env);
      const aiPerRun = Number.parseInt(env.AUTOPUBLISH_AI_PER_RUN ?? "10", 10);
      enrichment = await enrichPending({
        provider,
        store: new PostgresEnrichmentStore(driver),
        limit: Number.isFinite(aiPerRun) ? Math.min(Math.max(aiPerRun, 1), 50) : 10,
        deadlineMs: options.deadlineMs === undefined ? undefined : options.deadlineMs - 10_000,
      });
    } catch (error) {
      enrichment = { enabled: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const autopilot = await runAutopilot(
    {
      review: new PostgresReviewStore(driver),
      publication: new PostgresPublicationStore(driver),
      clusters: new PostgresClusterStore(driver),
      proposals: new PostgresProposalReader(driver),
    },
    { config, deadlineMs: options.deadlineMs },
  );
  return { enrichment, autopilot };
}
