import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import type { AiProposalLite } from "@/lib/autopilot/rules";
import { CATEGORY_IDS, type Category } from "@/lib/types";

interface ProposalRow {
  public_id: string;
  proposal: { category?: string | null; stateId?: string | null } | null;
  confidence: string | number | null;
}

/** Reads the most recent stored AI proposal for each candidate. The proposals are validated before storage. */
export class PostgresProposalReader {
  constructor(private readonly driver: DatabaseDriver) {}

  async latest(publicIds: string[]): Promise<Map<string, AiProposalLite>> {
    const found = new Map<string, AiProposalLite>();
    if (publicIds.length === 0) return found;
    const result = await this.driver.query<ProposalRow>(
      `select distinct on (c.id) c.public_id, e.proposal, e.confidence
       from ai_enrichments e
       join ingestion_candidates c on c.id = e.candidate_id
       where c.public_id = any($1::text[])
       order by c.id, e.processed_at desc`,
      [publicIds],
    );
    for (const row of result.rows) {
      const confidence = Number(row.confidence);
      const category = row.proposal?.category ?? null;
      if (!Number.isFinite(confidence)) continue;
      found.set(row.public_id, {
        category: category !== null && (CATEGORY_IDS as readonly string[]).includes(category) ? (category as Category) : null,
        stateId: row.proposal?.stateId ?? null,
        confidence,
      });
    }
    return found;
  }
}
