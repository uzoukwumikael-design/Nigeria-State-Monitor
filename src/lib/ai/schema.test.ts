// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validateEnrichmentText } from "@/lib/ai/schema";
import type { EnrichmentRequest } from "@/lib/ai/types";

const request: EnrichmentRequest = {
  candidate: {
    publicId: "cand-ai-test",
    category: null,
    stateId: null,
    lga: null,
  },
  article: {
    title: "Gunmen abduct Plateau varsity student in Jos North",
    excerpt: "Security sources said the student was later freed in Jos North.",
    publishedAt: "2026-11-05T06:00:00.000Z",
    retrievedAt: "2026-11-05T07:00:00.000Z",
    sourceSlug: "premium-times",
    sourceName: "Premium Times",
  },
};

function validProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: "security",
    stateId: "NG-PL",
    lga: "Jos North",
    confidence: 0.87,
    locationEvidence: ["Plateau varsity student", "Jos North"],
    summary: "A Plateau varsity student was reported abducted and later freed.",
    entities: ["Plateau State", "Jos North"],
    uncertainties: ["The source did not name the student or the institution."],
    analysis: null,
    ...overrides,
  };
}

function parse(value: Record<string, unknown>) {
  return validateEnrichmentText(JSON.stringify(value), request);
}

describe("AI enrichment validation", () => {
  it("accepts a valid proposal and canonicalises geography and confidence", () => {
    const result = validateEnrichmentText(
      JSON.stringify(
        validProposal({
          stateId: "ng-pl",
          lga: "jos north",
          confidence: 0.876,
        }),
      ),
      request,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal).toMatchObject({
      category: "security",
      stateId: "NG-PL",
      lga: "Jos North",
      confidence: 0.88,
    });
    expect(result.proposal.locationEvidence).toEqual(["Plateau varsity student", "Jos North"]);
  });

  it("accepts a single fenced JSON block", () => {
    const result = validateEnrichmentText(
      `\`\`\`json\n${JSON.stringify(validProposal())}\n\`\`\``,
      request,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts an explicitly unknown category and geography without evidence", () => {
    const result = parse(
      validProposal({
        category: null,
        stateId: null,
        lga: null,
        confidence: 0.2,
        locationEvidence: [],
        entities: [],
        uncertainties: ["The excerpt does not establish a location."],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal).toMatchObject({
      category: null,
      stateId: null,
      lga: null,
      confidence: 0.2,
    });
  });

  it("rejects empty and malformed responses", () => {
    expect(validateEnrichmentText("", request)).toMatchObject({ ok: false, code: "empty_response" });
    expect(validateEnrichmentText("not json", request)).toMatchObject({
      ok: false,
      code: "invalid_json",
    });
  });

  it("rejects unknown states and LGAs that do not belong to the state", () => {
    expect(parse(validProposal({ stateId: "NG-XX" }))).toMatchObject({
      ok: false,
      code: "unknown_state",
    });
    expect(parse(validProposal({ stateId: "NG-LA" }))).toMatchObject({
      ok: false,
      code: "unknown_lga",
    });
    expect(parse(validProposal({ stateId: null }))).toMatchObject({
      ok: false,
      code: "lga_without_state",
    });
  });

  it("requires exact location evidence for a geographic proposal", () => {
    expect(parse(validProposal({ locationEvidence: [] }))).toMatchObject({
      ok: false,
      code: "missing_location_evidence",
    });
    expect(parse(validProposal({ locationEvidence: ["Plateau student"] }))).toMatchObject({
      ok: false,
      code: "unsupported_location_evidence",
    });
  });

  it("rejects extra fields, including severity and coordinates", () => {
    expect(parse(validProposal({ severity: 5 }))).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
    expect(
      parse(
        validProposal({
          coordinates: { lat: 9.8, lng: 8.8 },
        }),
      ),
    ).toMatchObject({ ok: false, code: "schema_invalid" });
  });

  it("rejects URLs, control characters and oversized fields", () => {
    expect(parse(validProposal({ summary: "See https://example.com for details." }))).toMatchObject({
      ok: false,
      code: "unsupported_url",
    });
    expect(parse(validProposal({ summary: "Bad\u0001text" }))).toMatchObject({
      ok: false,
      code: "unsupported_content",
    });
    expect(parse(validProposal({ summary: "x".repeat(601) }))).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
    expect(parse(validProposal({ entities: Array.from({ length: 21 }, (_, i) => `Entity ${i}`) }))).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
    expect(parse(validProposal({ confidence: 1.1 }))).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
  });
});
