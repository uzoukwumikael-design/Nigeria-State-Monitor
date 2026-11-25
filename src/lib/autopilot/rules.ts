import { STATE_BY_ID } from "@/lib/geo/states";
import { CATEGORY_IDS, type Category, type Severity } from "@/lib/types";

/** The identity recorded in audit logs for automatic decisions. It is never a person. */
export const AUTOPILOT_ACTOR = "system.autopublish";
export const AUTOPILOT_RULE_VERSION = "nsm-autopilot-2026-11-11.1";

export interface AutopilotConfig {
  enabled: boolean;
  minCategoryConfidence: number;
  minGeoConfidence: number;
  /** An AI proposal is only used at or above this confidence. */
  minAiConfidence: number;
  maxPerRun: number;
}

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  enabled: true,
  minCategoryConfidence: 0.5,
  minGeoConfidence: 0.6,
  minAiConfidence: 0.7,
  maxPerRun: 30,
};

type Env = Record<string, string | undefined>;

function numberEnv(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number between ${min} and ${max}.`);
  }
  return value;
}

/** Reads AUTOPUBLISH* settings. `AUTOPUBLISH=off` is the kill switch; anything else keeps it on. */
export function autopilotConfigFromEnv(env: Env = process.env): AutopilotConfig {
  const switchValue = env.AUTOPUBLISH?.trim().toLowerCase();
  return {
    enabled: !(switchValue === "off" || switchValue === "false" || switchValue === "0"),
    minCategoryConfidence: numberEnv(env, "AUTOPUBLISH_MIN_CATEGORY_CONFIDENCE", DEFAULT_AUTOPILOT_CONFIG.minCategoryConfidence, 0, 1),
    minGeoConfidence: numberEnv(env, "AUTOPUBLISH_MIN_GEO_CONFIDENCE", DEFAULT_AUTOPILOT_CONFIG.minGeoConfidence, 0, 1),
    minAiConfidence: numberEnv(env, "AUTOPUBLISH_MIN_AI_CONFIDENCE", DEFAULT_AUTOPILOT_CONFIG.minAiConfidence, 0, 1),
    maxPerRun: Math.round(numberEnv(env, "AUTOPUBLISH_MAX_PER_RUN", DEFAULT_AUTOPILOT_CONFIG.maxPerRun, 1, 100)),
  };
}

export interface AutopilotCandidate {
  publicId: string;
  category: Category | null;
  stateId: string | null;
  categoryConfidence: number;
  geoConfidence: number;
  title: string;
  excerpt: string;
}

export interface AiProposalLite {
  category: Category | null;
  stateId: string | null;
  confidence: number;
}

export type SkipReason = "opinion" | "unresolved" | "low_confidence" | "ai_disagrees";

export type AutopilotDecision =
  | {
      action: "publish";
      category: Category;
      stateId: string;
      severity: Severity;
      severityRationale: string;
      classifier: "rules" | "ai" | "ai+rules";
      notes: string;
    }
  | { action: "skip"; reason: SkipReason; detail: string };

const OPINION = /^\s*(opinion|editorial|commentary|letters?|analysis|feature|column)\s*[:|–—-]/i;

const HIGH_IMPACT =
  /\b(killed|kills|dead|deaths?|died|dies|kidnap(?:ped|ping|s)?|abduct(?:ed|ion|s)?|explosions?|bomb(?:ing|ed|s)?|gunmen|massacre|attacks?|attacked|collapse[ds]?|outbreak|flood(?:ed|ing|s)?|displac(?:ed|ement)|crash(?:ed|es)?|fire|clashes|riots?)\b/i;

/**
 * Software-assigned severity. It reflects reported impact words only and is capped at level 3 (Moderate):
 * levels 4 and 5 need human judgement, which this path deliberately does not claim to provide.
 */
export function deriveSeverity(title: string, excerpt: string, category: Category): { severity: Severity; reason: string } {
  const match = `${title} ${excerpt}`.match(HIGH_IMPACT);
  if (match) {
    return { severity: 3, reason: `reported impact term "${match[0].toLowerCase()}"` };
  }
  if (category === "politics" || category === "economy") {
    return { severity: 1, reason: "routine political or economic reporting" };
  }
  return { severity: 2, reason: "no reported impact terms found" };
}

function isCategory(value: string | null): value is Category {
  return value !== null && (CATEGORY_IDS as readonly string[]).includes(value);
}

/** Decides whether a candidate publishes automatically, and with what classification and severity. */
export function evaluateCandidate(
  candidate: AutopilotCandidate,
  ai: AiProposalLite | null,
  config: AutopilotConfig = DEFAULT_AUTOPILOT_CONFIG,
): AutopilotDecision {
  if (OPINION.test(candidate.title)) {
    return { action: "skip", reason: "opinion", detail: "Headline looks like opinion or commentary." };
  }

  const rulesReady =
    candidate.category !== null &&
    candidate.stateId !== null &&
    candidate.categoryConfidence >= config.minCategoryConfidence &&
    candidate.geoConfidence >= config.minGeoConfidence;

  const aiReady =
    ai !== null &&
    isCategory(ai.category) &&
    ai.stateId !== null &&
    STATE_BY_ID.has(ai.stateId) &&
    ai.confidence >= config.minAiConfidence;

  let category: Category | null = null;
  let stateId: string | null = null;
  let classifier: "rules" | "ai" | "ai+rules" = "rules";

  if (aiReady && ai) {
    if (rulesReady && (candidate.category !== ai.category || candidate.stateId !== ai.stateId)) {
      return {
        action: "skip",
        reason: "ai_disagrees",
        detail: `Rules said ${candidate.category}/${candidate.stateId}; AI said ${ai.category}/${ai.stateId}.`,
      };
    }
    category = ai.category;
    stateId = ai.stateId;
    classifier = rulesReady ? "ai+rules" : "ai";
  } else if (rulesReady) {
    category = candidate.category;
    stateId = candidate.stateId;
  }

  if (!category || !stateId) {
    const unresolved = candidate.category === null || candidate.stateId === null;
    return {
      action: "skip",
      reason: unresolved ? "unresolved" : "low_confidence",
      detail: unresolved ? "No category or state could be resolved." : "Classifier confidence is below the publishing threshold.",
    };
  }

  const { severity, reason } = deriveSeverity(candidate.title, candidate.excerpt, category);
  return {
    action: "publish",
    category,
    stateId,
    severity,
    classifier,
    severityRationale: `Automatic: ${reason}. Software-assigned, capped at level 3, not assessed by a person.`,
    notes: `Automatic acceptance (${AUTOPILOT_RULE_VERSION}, classifier: ${classifier}). Not reviewed by a person.`,
  };
}
