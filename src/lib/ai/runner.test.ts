// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DisabledEnrichmentProvider } from "@/lib/ai/provider";
import { runEnrichment } from "@/lib/ai/runner";
import type {
  EnrichmentCandidate,
  EnrichmentMessages,
  EnrichmentMetadata,
  EnrichmentProposal,
  EnrichmentProvider,
  EnrichmentStore,
  EnrichmentStoreResult,
} from "@/lib/ai/types";

const NOW = new Date("2026-11-06T10:00:00.000Z");

const VALID_RESPONSE = JSON.stringify({
  category: "security",
  stateId: "NG-PL",
  lga: "Jos North",
  confidence: 0.87,
  locationEvidence: ["Plateau varsity student", "Jos North"],
  summary: "A Plateau varsity student was reported abducted and later freed.",
  entities: ["Plateau State", "Jos North"],
  uncertainties: ["The source did not name the student or the institution."],
  analysis: null,
});

function candidate(overrides: Partial<EnrichmentCandidate> = {}): EnrichmentCandidate {
  return {
    publicId: "cand-runner-test",
    status: "pending",
    category: null,
    stateId: null,
    lga: null,
    article: {
      title: "Gunmen abduct Plateau varsity student in Jos North",
      excerpt: "Security sources said the student was later freed in Jos North.",
      publishedAt: "2026-11-05T06:00:00.000Z",
      retrievedAt: "2026-11-05T07:00:00.000Z",
      sourceSlug: "premium-times",
      sourceName: "Premium Times",
      attribution: "Premium Times",
    },
    ...overrides,
  };
}

class FakeProvider implements EnrichmentProvider {
  readonly id = "fixture";
  readonly model = "fixture-model";
  readonly enabled = true;
  calls = 0;
  lastMessages: EnrichmentMessages | null = null;

  constructor(private readonly response: string | Error) {}

  async complete(messages: EnrichmentMessages): Promise<string> {
    this.calls += 1;
    this.lastMessages = messages;
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

class FakeStore implements EnrichmentStore {
  calls = 0;
  records: {
    candidatePublicId: string;
    proposal: EnrichmentProposal;
    metadata: EnrichmentMetadata;
  }[] = [];
  duplicate = false;

  constructor(private readonly result: EnrichmentStoreResult | null = null) {}

  async record(input: {
    candidatePublicId: string;
    proposal: EnrichmentProposal;
    metadata: EnrichmentMetadata;
  }): Promise<EnrichmentStoreResult> {
    this.calls += 1;
    this.records.push(input);
    return this.result ?? { ok: true, id: "enr-1", duplicate: this.duplicate };
  }
}

describe("AI enrichment runner", () => {
  it("does not call a disabled provider or the store", async () => {
    const provider = new DisabledEnrichmentProvider();
    const store = new FakeStore();
    const result = await runEnrichment({ provider, candidate: candidate(), store, now: NOW });

    expect(result).toEqual({ status: "disabled", provider: "disabled" });
    expect(store.calls).toBe(0);
  });

  it("validates, hashes and stores a proposal without updating evidence", async () => {
    const provider = new FakeProvider(VALID_RESPONSE);
    const store = new FakeStore();
    const result = await runEnrichment({
      provider,
      candidate: candidate({ status: "needs_review" }),
      store,
      now: NOW,
    });

    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    expect(result.proposal).toMatchObject({
      category: "security",
      stateId: "NG-PL",
      lga: "Jos North",
      confidence: 0.87,
    });
    expect(result.metadata).toMatchObject({
      provider: "fixture",
      model: "fixture-model",
      promptVersion: "nsm-enrichment-prompt-2026-11-06.1",
      schemaVersion: "nsm-enrichment-2026-11-06.1",
      processedAt: NOW.toISOString(),
    });
    expect(result.metadata.rawResponseHash).toBe(
      createHash("sha256").update(VALID_RESPONSE, "utf8").digest("hex"),
    );
    expect(store.calls).toBe(1);
    expect(store.records[0]).toMatchObject({
      candidatePublicId: "cand-runner-test",
      proposal: result.proposal,
      metadata: result.metadata,
    });
    expect(provider.lastMessages?.system).toContain("untrusted data");
    expect(provider.lastMessages?.user).toContain("Plateau varsity student");
  });

  it("rejects invalid output before the store", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        category: "security",
        stateId: "NG-XX",
        lga: null,
        confidence: 0.5,
        locationEvidence: ["Plateau varsity student"],
        summary: "Invalid state.",
        entities: [],
        uncertainties: [],
        analysis: null,
      }),
    );
    const store = new FakeStore();
    const result = await runEnrichment({ provider, candidate: candidate(), store, now: NOW });

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.code).toBe("unknown_state");
    expect(result.metadata.rawResponseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.calls).toBe(0);
  });

  it("returns a sanitised provider error without calling the store", async () => {
    const provider = new FakeProvider(new Error("upstream failed\nwith details"));
    const store = new FakeStore();
    const result = await runEnrichment({ provider, candidate: candidate(), store, now: NOW });

    expect(result).toMatchObject({
      status: "provider_error",
      provider: "fixture",
      message: "upstream failed with details",
    });
    expect(store.calls).toBe(0);
  });

  it("skips a rejected candidate without calling the provider", async () => {
    const provider = new FakeProvider(VALID_RESPONSE);
    const store = new FakeStore();
    const result = await runEnrichment({
      provider,
      candidate: candidate({ status: "rejected" }),
      store,
      now: NOW,
    });

    expect(result).toMatchObject({ status: "skipped", code: "rejected_candidate" });
    expect(provider.calls).toBe(0);
    expect(store.calls).toBe(0);
  });

  it("preserves a duplicate result with the existing enrichment id", async () => {
    const provider = new FakeProvider(VALID_RESPONSE);
    const store = new FakeStore({ ok: true, id: "existing-enr", duplicate: true });
    const result = await runEnrichment({ provider, candidate: candidate(), store, now: NOW });

    expect(result).toMatchObject({
      status: "stored",
      enrichmentId: "existing-enr",
      duplicate: true,
    });
  });
});
