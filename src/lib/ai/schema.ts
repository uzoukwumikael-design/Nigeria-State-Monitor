import { z } from "zod";
import { canonicalLgaName } from "@/lib/geo/lga";
import { STATE_BY_ID } from "@/lib/geo/states";
import { CATEGORY_IDS } from "@/lib/types";
import {
  MAX_ANALYSIS_LENGTH,
  MAX_ENTITIES,
  MAX_LOCATION_EVIDENCE,
  MAX_SUMMARY_LENGTH,
  MAX_UNCERTAINTIES,
} from "@/lib/ai/constants";
import type {
  EnrichmentProposal,
  EnrichmentRequest,
  EnrichmentValidationCode,
  EnrichmentValidationResult,
} from "@/lib/ai/types";

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const rawProposalSchema = z
  .object({
    category: z.enum(CATEGORY_IDS).nullable(),
    stateId: z.string().trim().min(1).max(16).nullable(),
    lga: z.string().trim().min(1).max(120).nullable(),
    confidence: z.number().min(0).max(1),
    locationEvidence: z
      .array(z.string().trim().min(1).max(200))
      .max(MAX_LOCATION_EVIDENCE),
    summary: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH),
    entities: z.array(z.string().trim().min(1).max(120)).max(MAX_ENTITIES),
    uncertainties: z.array(z.string().trim().min(1).max(300)).max(MAX_UNCERTAINTIES),
    analysis: z.string().trim().max(MAX_ANALYSIS_LENGTH).nullable(),
  })
  .strict();

function failure(code: EnrichmentValidationCode, message: string): EnrichmentValidationResult {
  return { ok: false, code, message };
}

function stripJsonFences(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function normalizeEvidence(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function textValues(proposal: z.infer<typeof rawProposalSchema>): string[] {
  return [
    proposal.summary,
    proposal.analysis ?? "",
    ...proposal.locationEvidence,
    ...proposal.entities,
    ...proposal.uncertainties,
  ].filter((value) => value.length > 0);
}

/**
 * Validates a raw model response without touching the database. Structural
 * fields are checked by Zod; geography is checked against the authoritative
 * state registry and LGA gazetteer. Evidence phrases must appear verbatim in the
 * supplied title or excerpt, so a model cannot invent a location quote.
 */
export function validateEnrichmentText(
  rawText: string,
  request: EnrichmentRequest,
): EnrichmentValidationResult {
  const text = stripJsonFences(rawText);
  if (!text) {
    return failure("empty_response", "The provider returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure("invalid_json", "The provider response was not valid JSON.");
  }

  const schema = rawProposalSchema.safeParse(parsed);
  if (!schema.success) {
    const issue = schema.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "response";
    return failure(
      "schema_invalid",
      `The proposal failed schema validation at ${path}: ${issue?.message ?? "invalid value"}.`,
    );
  }

  const value = schema.data;
  const allText = textValues(value);
  if (allText.some((entry) => CONTROL_PATTERN.test(entry))) {
    return failure("unsupported_content", "The proposal contains control characters.");
  }
  if (allText.some((entry) => URL_PATTERN.test(entry))) {
    return failure("unsupported_url", "The proposal contains a URL. Enrichment text must not include links.");
  }

  const stateId = value.stateId ? value.stateId.trim().toUpperCase() : null;
  if (stateId && !STATE_BY_ID.has(stateId)) {
    return failure("unknown_state", `The proposal names an unknown state: ${stateId}.`);
  }

  let lga: string | null = null;
  if (value.lga) {
    if (!stateId) {
      return failure("lga_without_state", "An LGA cannot be accepted without a state.");
    }
    lga = canonicalLgaName(stateId, value.lga);
    if (!lga) {
      return failure(
        "unknown_lga",
        `The proposal names an LGA that is not in the gazetteer for ${stateId}.`,
      );
    }
  }

  const sourceText = normalizeEvidence(`${request.article.title} ${request.article.excerpt}`);
  if ((stateId || lga) && value.locationEvidence.length === 0) {
    return failure(
      "missing_location_evidence",
      "A geographic proposal requires at least one exact location phrase from the title or excerpt.",
    );
  }
  for (const evidence of value.locationEvidence) {
    const normalized = normalizeEvidence(evidence);
    if (!normalized || !sourceText.includes(normalized)) {
      return failure(
        "unsupported_location_evidence",
        "A locationEvidence phrase was not found verbatim in the title or excerpt.",
      );
    }
  }

  const proposal: EnrichmentProposal = {
    category: value.category,
    stateId,
    lga,
    confidence: Math.round(value.confidence * 100) / 100,
    locationEvidence: value.locationEvidence,
    summary: value.summary,
    entities: value.entities,
    uncertainties: value.uncertainties,
    analysis: value.analysis,
  };

  return { ok: true, proposal };
}
