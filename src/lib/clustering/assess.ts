import { normalizeForMatch } from "@/lib/ingestion/text";
import {
  CLUSTER_AUTO_ATTACH_THRESHOLD,
  CLUSTER_REVIEW_THRESHOLD,
  CLUSTER_SCORE_VERSION,
  CLUSTER_TIME_WINDOW_HOURS,
  type ClusterAssessment,
  type ClusterDecision,
  type ClusterGateFailure,
  type ClusterGateState,
  type ClusterRecord,
  type ClusterScoreComponents,
} from "./types";

const WINDOW_MS = CLUSTER_TIME_WINDOW_HOURS * 60 * 60 * 1_000;

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "after",
  "amid",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "over",
  "said",
  "say",
  "says",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

const ENTITY_STOP_WORDS = new Set([
  "a",
  "after",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "breaking",
  "but",
  "by",
  "during",
  "exclusive",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "new",
  "of",
  "on",
  "or",
  "over",
  "said",
  "say",
  "says",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "to",
  "under",
  "update",
  "was",
  "were",
  "with",
]);

const ENTITY_PATTERN = /\b(?:\d[\d,.]*|[\p{Lu}][\p{L}\p{N}'’-]*)\b/gu;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function dice(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const token of small) {
    if (large.has(token)) shared += 1;
  }
  return round((2 * shared) / (left.size + right.size), 4);
}

function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of normalizeForMatch(title).split(" ")) {
    if (!token) continue;
    if (TITLE_STOP_WORDS.has(token)) continue;
    if (token.length === 1 && !/^\d$/.test(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/**
 * Deterministic proper-noun proxy: capitalised words and numbers, with common
 * sentence words removed. This is not named-entity recognition; it is a
 * repeatable overlap signal that never invents an entity.
 */
function entityTokens(record: ClusterRecord): Set<string> {
  const text = `${record.title} ${record.excerpt ?? ""}`;
  const tokens = new Set<string>();
  for (const match of text.matchAll(ENTITY_PATTERN)) {
    const raw = match[0].replace(/[’']s$/i, "");
    const token = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!token || token.length < 2 || ENTITY_STOP_WORDS.has(token)) continue;
    tokens.add(token);
  }
  // Headlines often use sentence case, so a proper noun may be lowercase
  // mid-sentence. Add the significant title tokens to keep the entity signal
  // symmetric without inventing a named entity.
  for (const token of titleTokens(record.title)) tokens.add(token);
  return tokens;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedGroup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function numericTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of title.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) {
    tokens.add(match[0].replaceAll(",", ""));
  }
  return tokens;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function normalizeLga(value: string | null): string {
  return value ? normalizeForMatch(value) : "";
}

function geographyAgreement(left: ClusterRecord, right: ClusterRecord): number {
  const leftLga = normalizeLga(left.lga);
  const rightLga = normalizeLga(right.lga);
  if (leftLga && rightLga) return leftLga === rightLga ? 1 : 0;
  if (!leftLga && !rightLga) return 0.85;
  return 0.8;
}

/**
 * Converts an already-computed similarity score into the safe decision. A
 * high score never overrides a conflicting LGA or non-independent evidence.
 */
export function clusterDecisionForScore(
  score: number,
  options: { independent?: boolean; lgaConflict?: boolean; numericConflict?: boolean } = {},
): ClusterDecision {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError("Cluster similarity must be a finite number between 0 and 1.");
  }
  const independent = options.independent ?? true;
  const lgaConflict = options.lgaConflict ?? false;
  const numericConflict = options.numericConflict ?? false;
  if (
    score >= CLUSTER_AUTO_ATTACH_THRESHOLD &&
    independent &&
    !lgaConflict &&
    !numericConflict
  ) {
    return "auto_attach";
  }
  if (score >= CLUSTER_REVIEW_THRESHOLD) return "review";
  return "no_match";
}

function failureMessage(failure: ClusterGateFailure): string {
  switch (failure) {
    case "same_record":
      return "A record cannot be clustered with itself.";
    case "unresolved_category":
      return "Both records need a resolved category before clustering.";
    case "category_mismatch":
      return "Categories differ; the pair is kept separate.";
    case "unresolved_geography":
      return "Both records need a resolved state before clustering.";
    case "geography_mismatch":
      return "States differ; the pair is kept separate.";
    case "invalid_time":
      return "Both records need a valid publication time before clustering.";
    case "outside_time_window":
      return `Publication times are more than ${CLUSTER_TIME_WINDOW_HOURS} hours apart.`;
  }
}

/**
 * Applies the hard gates first, then scores the pair. The function is pure and
 * never writes a cluster, creates an event or changes a candidate.
 */
export function assessClusterPair(
  candidate: ClusterRecord,
  existing: ClusterRecord,
): ClusterAssessment {
  const candidateTime = parseTime(candidate.publishedAt);
  const existingTime = parseTime(existing.publishedAt);
  const distinct = candidate.id !== existing.id;
  const categoryResolved = candidate.category !== null && existing.category !== null;
  const categoryMatch = categoryResolved && candidate.category === existing.category;
  const geographyResolved = candidate.stateId !== null && existing.stateId !== null;
  const geographyMatch =
    geographyResolved && candidate.stateId === existing.stateId;
  const timeValid =
    candidateTime !== null &&
    existingTime !== null &&
    Math.abs(candidateTime - existingTime) <= WINDOW_MS;

  const candidateLga = normalizeLga(candidate.lga);
  const existingLga = normalizeLga(existing.lga);
  const lgaConflict =
    geographyMatch && Boolean(candidateLga) && Boolean(existingLga) && candidateLga !== existingLga;

  const candidateNumbers = numericTokens(candidate.title);
  const existingNumbers = numericTokens(existing.title);
  const numericConflict =
    candidateNumbers.size > 0 &&
    existingNumbers.size > 0 &&
    !sameSet(candidateNumbers, existingNumbers);

  const candidatePublisher = normalizedGroup(candidate.publisher);
  const existingPublisher = normalizedGroup(existing.publisher);
  const candidateGroup = normalizedGroup(candidate.independenceGroup);
  const existingGroup = normalizedGroup(existing.independenceGroup);
  const independent =
    candidatePublisher !== existingPublisher && candidateGroup !== existingGroup;

  const gates: ClusterGateState = {
    distinct,
    category: categoryMatch,
    geography: geographyMatch,
    time: timeValid,
    lgaConflict,
    numericConflict,
    independent,
  };

  let failure: ClusterGateFailure | null = null;
  if (!distinct) failure = "same_record";
  else if (!categoryResolved) failure = "unresolved_category";
  else if (!categoryMatch) failure = "category_mismatch";
  else if (!geographyResolved) failure = "unresolved_geography";
  else if (!geographyMatch) failure = "geography_mismatch";
  else if (candidateTime === null || existingTime === null) failure = "invalid_time";
  else if (!timeValid) failure = "outside_time_window";

  if (failure) {
    return {
      scoreVersion: CLUSTER_SCORE_VERSION,
      candidateId: candidate.id,
      existingId: existing.id,
      decision: "no_match",
      similarity: null,
      components: null,
      gates,
      independent,
      failure,
      reasons: [failureMessage(failure)],
    };
  }

  const timeDifference = Math.abs((candidateTime ?? 0) - (existingTime ?? 0));
  const time = round(Math.max(0, Math.min(1, 1 - timeDifference / WINDOW_MS)), 4);
  const title = dice(titleTokens(candidate.title), titleTokens(existing.title));
  const entity = dice(entityTokens(candidate), entityTokens(existing));
  const geography = geographyAgreement(candidate, existing);

  const components: ClusterScoreComponents = { title, entity, geography, time };
  const similarity = round(
    0.45 * title + 0.25 * entity + 0.2 * geography + 0.1 * time,
    3,
  );
  const decision = clusterDecisionForScore(similarity, {
    independent,
    lgaConflict,
    numericConflict,
  });

  const reasons: string[] = [];
  if (lgaConflict) {
    reasons.push("Known LGAs differ; auto-attach is blocked.");
  }
  if (numericConflict) {
    reasons.push("Headline numbers differ; contradictory counts block auto-attach.");
  }
  if (!independent) {
    reasons.push(
      candidatePublisher === existingPublisher
        ? "Same publisher is not independent corroboration."
        : "Same independence group is not independent corroboration.",
    );
  }
  if (similarity >= CLUSTER_AUTO_ATTACH_THRESHOLD && decision !== "auto_attach") {
    reasons.push("The score meets the auto-attach threshold, but a conflict or independence gate blocks it.");
  }
  if (decision === "auto_attach") {
    reasons.push("All hard gates passed and the similarity score meets the auto-attach threshold.");
  } else if (decision === "review") {
    reasons.push("Similarity meets the review threshold; a reviewer must decide before attachment.");
  } else {
    reasons.push("Similarity is below the review threshold; keep the records separate.");
  }

  return {
    scoreVersion: CLUSTER_SCORE_VERSION,
    candidateId: candidate.id,
    existingId: existing.id,
    decision,
    similarity,
    components,
    gates,
    independent,
    failure: null,
    reasons,
  };
}
