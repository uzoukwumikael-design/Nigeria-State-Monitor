import { describe, expect, it, vi } from "vitest";
import { runAutopilot, type AutopilotDeps } from "./run";
import { AUTOPILOT_ACTOR, DEFAULT_AUTOPILOT_CONFIG } from "./rules";
import type { ReviewCandidate } from "@/lib/review/types";

function candidate(id: string, overrides: Partial<ReviewCandidate> = {}, title = "Council begins road repairs"): ReviewCandidate {
  return {
    id,
    publicId: id,
    status: "pending",
    category: "infrastructure",
    stateId: "NG-LA",
    lga: null,
    categoryConfidence: 0.8,
    geoConfidence: 0.9,
    reasons: [],
    ruleVersion: "t",
    createdAt: "2026-11-11T00:00:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    article: {
      publicId: `a-${id}`,
      title,
      url: `https://example.ng/${id}`,
      excerpt: "Work started.",
      publishedAt: null,
      retrievedAt: "2026-11-11T00:00:00.000Z",
      sourceSlug: "x",
      sourceName: "X",
      attribution: "X",
    },
    ...overrides,
  };
}

/** In-memory stand-ins. `duplicates` maps a candidate to the one it duplicates once that one is published. */
function fakeDeps(open: ReviewCandidate[], duplicates: Record<string, string> = {}) {
  const accepted: string[] = [];
  const rejected: Array<{ id: string; notes?: string | null }> = [];
  const published: string[] = [];
  const attached: string[] = [];
  let queue: Array<{ id: string; candidate: string }> = [];

  const deps: AutopilotDeps = {
    review: {
      listReviewQueue: async () => open,
      decide: async (input) => {
        if (input.action === "accept") accepted.push(input.candidatePublicId);
        else rejected.push({ id: input.candidatePublicId, notes: input.notes });
        return { ok: true, candidate: open[0]!, reviewId: "r" };
      },
    },
    publication: {
      listPublishable: async () =>
        accepted
          .filter((id) => !published.includes(id) && !attached.includes(id))
          .slice(0, 1)
          .map((id) => ({ publicId: id, status: "accepted", category: "infrastructure", stateId: "NG-LA", stateName: "Lagos", lga: null, title: "Council begins road repairs", excerpt: "Work started.", sourceSlug: "x", sourceName: "X", publishedAt: null, retrievedAt: "", reviewedAt: null, reviewedBy: AUTOPILOT_ACTOR }) as never),
      publish: async (input) => {
        published.push(input.candidatePublicId);
        return { ok: true, event: {} as never, linkId: "l", auditId: "a", snapshotVersion: "v" };
      },
    },
    clusters: {
      scan: async () => {
        queue = accepted
          .filter((id) => !published.includes(id) && !attached.includes(id) && duplicates[id] && published.includes(duplicates[id]!))
          .map((id) => ({ id: `cluster-${id}`, candidate: id }));
        return { scannedCandidates: 0, comparedEvents: 0, queuedForReview: queue.length, autoAttached: 0, skipped: 0 };
      },
      listQueue: async () => queue.map((item) => ({ id: item.id, similarity: 0.8 }) as never),
      review: async (input) => {
        const item = queue.find((entry) => entry.id === input.clusterId);
        if (item) attached.push(item.candidate);
        queue = queue.filter((entry) => entry.id !== input.clusterId);
        return { ok: true } as never;
      },
    },
    proposals: { latest: async () => new Map() },
  };
  return { deps, accepted, rejected, published, attached };
}

describe("runAutopilot", () => {
  it("does nothing at all when switched off", async () => {
    const fake = fakeDeps([candidate("c1")]);
    const list = vi.spyOn(fake.deps.review, "listReviewQueue");
    const summary = await runAutopilot(fake.deps, { config: { ...DEFAULT_AUTOPILOT_CONFIG, enabled: false } });
    expect(summary.enabled).toBe(false);
    expect(list).not.toHaveBeenCalled();
    expect(fake.published).toEqual([]);
  });

  it("accepts and publishes eligible candidates under the system actor, and declines the rest with a reason", async () => {
    const fake = fakeDeps([
      candidate("good"),
      candidate("opinion", {}, "Opinion: why roads fail"),
      candidate("nostate", { stateId: null }),
      candidate("weak", { geoConfidence: 0.2 }),
    ]);
    const summary = await runAutopilot(fake.deps, { config: DEFAULT_AUTOPILOT_CONFIG });
    expect(summary).toMatchObject({ considered: 4, accepted: 1, published: 1, attached: 0 });
    expect(summary.declined).toEqual({ opinion: 1, unresolved: 1, low_confidence: 1, ai_disagrees: 0 });
    expect(fake.published).toEqual(["good"]);
    expect(fake.rejected.map((entry) => entry.id).sort()).toEqual(["nostate", "opinion", "weak"]);
    expect(fake.rejected[0]?.notes).toMatch(/^Automatic decline \(/);
  });

  it("publishes one event for a story two outlets reported, attaching the second instead of duplicating it", async () => {
    const fake = fakeDeps([candidate("first"), candidate("second")], { second: "first" });
    const summary = await runAutopilot(fake.deps, { config: DEFAULT_AUTOPILOT_CONFIG });
    expect(fake.published).toEqual(["first"]);
    expect(fake.attached).toEqual(["second"]);
    expect(summary).toMatchObject({ accepted: 2, published: 1, attached: 1 });
  });

  it("respects the per-run cap", async () => {
    const fake = fakeDeps([candidate("a"), candidate("b"), candidate("c")]);
    const summary = await runAutopilot(fake.deps, { config: { ...DEFAULT_AUTOPILOT_CONFIG, maxPerRun: 2 } });
    expect(summary.accepted).toBe(2);
    expect(summary.published).toBe(2);
  });

  it("stops starting work when the time budget is spent and says so", async () => {
    const fake = fakeDeps([candidate("a"), candidate("b")]);
    let tick = 0;
    const summary = await runAutopilot(fake.deps, {
      config: DEFAULT_AUTOPILOT_CONFIG,
      deadlineMs: 100,
      now: () => (tick += 60),
    });
    expect(summary.timeBudgetReached).toBe(true);
    expect(summary.published).toBeLessThan(2);
  });

  it("stops rather than spinning when a publish fails, and reports why", async () => {
    const fake = fakeDeps([candidate("a"), candidate("b")]);
    const publish = vi.fn(async () => ({ ok: false as const, code: "unresolved_state" as const, message: "no state" }));
    fake.deps.publication.publish = publish;
    const summary = await runAutopilot(fake.deps, { config: DEFAULT_AUTOPILOT_CONFIG });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(summary.published).toBe(0);
    expect(summary.errors.join(" ")).toMatch(/publish failed \(unresolved_state\)/);
  });
});
