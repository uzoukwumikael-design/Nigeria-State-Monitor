import { describe, expect, it, vi } from "vitest";
import { enrichPending } from "./enrich";
import type { EnrichmentCandidate, EnrichmentProvider } from "@/lib/ai/types";

const candidates: EnrichmentCandidate[] = ["c1", "c2", "c3"].map((publicId) => ({
  publicId,
  status: "pending",
  category: null,
  stateId: null,
  lga: null,
  article: {
    title: "Flood displaces residents in Owerri",
    excerpt: "Heavy rain flooded parts of Owerri.",
    publishedAt: null,
    retrievedAt: "2026-11-11T00:00:00.000Z",
    sourceSlug: "x",
    sourceName: "X",
    attribution: "X",
  },
}));
const store = { listCandidates: async (limit: number) => candidates.slice(0, limit), record: vi.fn(async () => ({ ok: true as const, id: "e", duplicate: false })) };

function provider(enabled: boolean, complete: () => Promise<string>): EnrichmentProvider {
  return { id: "test", model: "m", enabled, complete } as unknown as EnrichmentProvider;
}

const GOOD = JSON.stringify({ category: "environment", stateId: "NG-IM", lga: null, confidence: 0.9, locationEvidence: ["Owerri"], summary: "Flooding in Owerri.", entities: [], uncertainties: [], analysis: null });

describe("enrichPending", () => {
  it("makes no model calls when AI is disabled", async () => {
    const complete = vi.fn(async () => GOOD);
    const summary = await enrichPending({ provider: provider(false, complete), store, limit: 5 });
    expect(summary).toMatchObject({ enabled: false, attempted: 0 });
    expect(complete).not.toHaveBeenCalled();
  });

  it("stores valid proposals, counts failures and keeps going", async () => {
    const complete = vi.fn().mockResolvedValueOnce(GOOD).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce("not json");
    const summary = await enrichPending({ provider: provider(true, complete), store, limit: 5 });
    expect(summary).toMatchObject({ attempted: 3, stored: 1, failed: 2 });
  });

  it("honours the per-run limit and the time budget", async () => {
    const complete = vi.fn(async () => GOOD);
    expect((await enrichPending({ provider: provider(true, complete), store, limit: 2 })).attempted).toBe(2);
    let tick = 0;
    const late = await enrichPending({ provider: provider(true, complete), store, limit: 3, deadlineMs: 100, now: () => (tick += 60) });
    expect(late.timeBudgetReached).toBe(true);
    expect(late.attempted).toBeLessThan(3);
  });
});
