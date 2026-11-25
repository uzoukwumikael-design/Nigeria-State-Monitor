export const ENRICHMENT_PROMPT_VERSION = "nsm-enrichment-prompt-2026-11-06.1";
export const ENRICHMENT_SCHEMA_VERSION = "nsm-enrichment-2026-11-06.1";

export const MAX_PROMPT_TITLE = 300;
export const MAX_PROMPT_EXCERPT = 320;
export const MAX_SUMMARY_LENGTH = 600;
export const MAX_ANALYSIS_LENGTH = 1_200;
export const MAX_LOCATION_EVIDENCE = 10;
export const MAX_ENTITIES = 20;
export const MAX_UNCERTAINTIES = 10;

export const ENRICHMENT_FIELD_KEYS = [
  "category",
  "stateId",
  "lga",
  "confidence",
  "locationEvidence",
  "summary",
  "entities",
  "uncertainties",
  "analysis",
] as const;

export type EnrichmentFieldKey = (typeof ENRICHMENT_FIELD_KEYS)[number];
