import lgaData from "@/data/lga-gazetteer.json";
import { STATES } from "@/lib/geo/states";
import type { Category, ZoneId } from "@/lib/types";
import type {
  CandidateProposal,
  CategoryPrior,
  GeographyPrior,
} from "@/lib/ingestion/types";
import { containsPhrase, countPhrase, normalizeForMatch } from "@/lib/ingestion/text";

/**
 * Deterministic priors run before any AI proposal. They are deliberately
 * conservative: an unresolved or ambiguous result becomes `needs_review`
 * rather than a confident claim. These values are persisted with every
 * candidate so a later proposal can be audited against its inputs.
 */
export const PRIOR_RULE_VERSION = "nsm-priors-2026-11-05.1";

const CATEGORY_ORDER: readonly Category[] = [
  "security",
  "politics",
  "economy",
  "infrastructure",
  "environment",
  "health",
];

type Rules = readonly (readonly [phrase: string, weight: number])[];

const CATEGORY_RULES: Record<Category, Rules> = {
  security: [
    ["killed", 3],
    ["kill", 2],
    ["killing", 2],
    ["death", 2],
    ["dead", 2],
    ["murder", 3],
    ["gunmen", 3],
    ["gunman", 3],
    ["bandit", 3],
    ["bandits", 3],
    ["banditry", 3],
    ["kidnap", 3],
    ["kidnapped", 3],
    ["abduct", 3],
    ["abducted", 3],
    ["abduction", 3],
    ["terrorist", 3],
    ["terrorism", 3],
    ["boko haram", 3],
    ["iswap", 3],
    ["insurgent", 3],
    ["insurgents", 3],
    ["attack", 2],
    ["attacked", 2],
    ["ambush", 3],
    ["explosion", 3],
    ["bomb", 3],
    ["shooting", 3],
    ["shot dead", 3],
    ["clash", 2],
    ["clashes", 2],
    ["violence", 2],
    ["violent", 2],
    ["robbery", 3],
    ["armed robbery", 3],
    ["ransom", 3],
    ["rescued", 2],
    ["arrest", 2],
    ["arrested", 2],
    ["police", 1],
    ["military", 1],
    ["soldier", 1],
    ["soldiers", 1],
    ["troops", 1],
    ["insecurity", 2],
    ["cultist", 3],
    ["vigilante", 2],
    ["oil theft", 2],
    ["piracy", 2],
    ["militia", 2],
    ["communal", 2],
    ["reprisal", 3],
  ],
  politics: [
    ["election", 3],
    ["elections", 3],
    ["inec", 3],
    ["governor", 2],
    ["senate", 2],
    ["senator", 2],
    ["president", 2],
    ["presidency", 2],
    ["minister", 2],
    ["apc", 2],
    ["pdp", 2],
    ["labour party", 2],
    ["nnpp", 2],
    ["adc", 2],
    ["tribunal", 2],
    ["court", 1],
    ["judiciary", 2],
    ["judicial", 2],
    ["judge", 2],
    ["judges", 2],
    ["chief justice", 3],
    ["njc", 3],
    ["national judicial council", 3],
    ["assembly", 2],
    ["lawmaker", 2],
    ["lawmakers", 2],
    ["constitution", 2],
    ["impeachment", 3],
    ["defection", 2],
    ["campaign", 2],
    ["ballot", 2],
    ["vote", 2],
    ["voters", 2],
    ["political", 2],
    ["politician", 2],
    ["appointment", 2],
    ["appointed", 2],
    ["cabinet", 2],
    ["local government", 1],
    ["council chairman", 2],
    ["governorship", 3],
    ["primary election", 3],
    ["running mate", 3],
    ["state assembly", 3],
    ["national assembly", 3],
  ],
  economy: [
    ["inflation", 3],
    ["naira", 3],
    ["cbn", 3],
    ["central bank", 3],
    ["economy", 2],
    ["economic", 2],
    ["gdp", 3],
    ["oil price", 2],
    ["fuel", 2],
    ["petrol", 2],
    ["subsidy", 2],
    ["market", 1],
    ["trade", 1],
    ["export", 2],
    ["import", 2],
    ["budget", 2],
    ["revenue", 2],
    ["tax", 2],
    ["debt", 2],
    ["investment", 2],
    ["business", 1],
    ["nnpc", 3],
    ["refinery", 2],
    ["dangote", 2],
    ["customs", 2],
    ["tariff", 2],
    ["exchange rate", 3],
    ["forex", 3],
    ["dollar", 1],
    ["price", 1],
    ["cost of living", 3],
    ["unemployment", 2],
    ["pension", 2],
    ["stock market", 3],
    ["capital market", 3],
    ["bank", 1],
    ["loan", 1],
    ["interest rate", 3],
    ["monetary policy", 3],
    ["fiscal", 2],
    ["revenue allocation", 2],
    ["investors", 2],
    ["manufacturers", 2],
  ],
  infrastructure: [
    ["road", 2],
    ["highway", 3],
    ["bridge", 2],
    ["airport", 3],
    ["railway", 3],
    ["rail", 2],
    ["power", 2],
    ["electricity", 3],
    ["grid", 2],
    ["blackout", 3],
    ["water supply", 3],
    ["dam", 2],
    ["construction", 2],
    ["port", 1],
    ["transport", 2],
    ["broadband", 3],
    ["telecom", 2],
    ["mtn", 2],
    ["network", 1],
    ["infrastructure", 2],
    ["building collapse", 3],
    ["collapsed building", 3],
    ["flyover", 2],
    ["road project", 3],
    ["power plant", 3],
    ["transformer", 2],
    ["borehole", 2],
    ["housing", 1],
    ["rail line", 3],
    ["seaport", 2],
    ["airline", 2],
    ["flight", 1],
  ],
  environment: [
    ["flood", 3],
    ["flooding", 3],
    ["erosion", 3],
    ["climate", 3],
    ["heatwave", 3],
    ["heat wave", 3],
    ["drought", 3],
    ["desertification", 3],
    ["pollution", 3],
    ["oil spill", 3],
    ["gas flaring", 3],
    ["deforestation", 3],
    ["wildlife", 2],
    ["earthquake", 3],
    ["landslide", 3],
    ["emission", 2],
    ["emissions", 2],
    ["cop31", 3],
    ["cop30", 3],
    ["sanitation", 2],
    ["waste", 2],
    ["environment", 2],
    ["environmental", 2],
    ["forest", 2],
    ["mining", 2],
    ["illegal mining", 3],
    ["lead poisoning", 3],
    ["air quality", 3],
    ["rainfall", 2],
  ],
  health: [
    ["hospital", 3],
    ["health", 2],
    ["doctor", 2],
    ["doctors", 2],
    ["nurse", 2],
    ["nurses", 2],
    ["cholera", 3],
    ["malaria", 3],
    ["outbreak", 3],
    ["disease", 2],
    ["vaccination", 3],
    ["vaccine", 3],
    ["measles", 3],
    ["lassa", 3],
    ["diphtheria", 3],
    ["mpox", 3],
    ["covid", 2],
    ["maternal", 3],
    ["mortality", 2],
    ["medical", 2],
    ["clinic", 2],
    ["medicine", 2],
    ["drug", 1],
    ["nhis", 3],
    ["world health organisation", 3],
    ["nutrition", 2],
    ["mental health", 3],
    ["health workers", 3],
    ["infection", 2],
    ["patients", 2],
  ],
};

function emptyScores(): Record<Category, number> {
  return {
    security: 0,
    politics: 0,
    economy: 0,
    infrastructure: 0,
    environment: 0,
    health: 0,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Scores category evidence from the headline (weighted twice), the feed's own
 * section/topic tags and the excerpt. Ambiguity is resolved to `null`, never to
 * a guess.
 */
export function classifyCategory(
  title: string,
  categories: readonly string[],
  excerpt: string,
): CategoryPrior {
  const titleText = normalizeForMatch(title);
  const tagText = normalizeForMatch(categories.join(" "));
  const excerptText = normalizeForMatch(excerpt);

  const scores = emptyScores();
  const matched: { category: Category; phrase: string; score: number }[] = [];

  for (const category of CATEGORY_ORDER) {
    for (const [phrase, weight] of CATEGORY_RULES[category]) {
      const titleHits = Math.min(2, countPhrase(titleText, phrase));
      const otherHits = Math.min(1, countPhrase(tagText, phrase)) + Math.min(1, countPhrase(excerptText, phrase));
      const hits = titleHits * 2 + otherHits;
      if (hits > 0) {
        scores[category] += hits * weight;
        matched.push({ category, phrase, score: hits * weight });
      }
    }
  }

  const ranked = CATEGORY_ORDER.map((category) => ({ category, score: scores[category] })).sort(
    (a, b) => b.score - a.score || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
  const top = ranked[0];
  const second = ranked[1];
  const matches = matched
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => `${entry.category}:${entry.phrase}`);

  if (!top || top.score < 2) {
    return { category: null, confidence: 0, scores, matches, ambiguous: false };
  }

  const runnerUp = second?.score ?? 0;
  if (runnerUp >= top.score * 0.8) {
    return {
      category: null,
      confidence: round2(Math.min(0.5, top.score / Math.max(1, top.score + runnerUp))),
      scores,
      matches,
      ambiguous: true,
    };
  }

  const confidence = round2(Math.min(0.95, (top.score - runnerUp * 0.8) / top.score));
  return {
    category: top.category,
    confidence,
    scores,
    matches,
    ambiguous: false,
  };
}

interface GazetteerEntry {
  name: string;
  stateId: string;
  lat: number;
  lng: number;
  areaKm2: number;
}

interface StateAlias {
  stateId: string;
  phrase: string;
  kind: "state" | "capital" | "alias";
}

interface CityAlias {
  stateId: string;
  phrase: string;
}

/**
 * Secondary cities that are not LGA names. State capitals are added
 * automatically; this list only fills gaps such as Warri or Onitsha.
 */
const CITY_ALIASES: readonly CityAlias[] = [
  { stateId: "NG-DE", phrase: "Warri" },
  { stateId: "NG-AN", phrase: "Onitsha" },
  { stateId: "NG-AN", phrase: "Nnewi" },
  { stateId: "NG-KD", phrase: "Zaria" },
  { stateId: "NG-KD", phrase: "Kafanchan" },
  { stateId: "NG-EN", phrase: "Nsukka" },
  { stateId: "NG-OG", phrase: "Ijebu Ode" },
  { stateId: "NG-OG", phrase: "Sango Ota" },
  { stateId: "NG-OS", phrase: "Ilesa" },
  { stateId: "NG-OS", phrase: "Iwo" },
  { stateId: "NG-OY", phrase: "Ogbomoso" },
  { stateId: "NG-OY", phrase: "Iseyin" },
  { stateId: "NG-LA", phrase: "Ikorodu" },
  { stateId: "NG-LA", phrase: "Badagry" },
  { stateId: "NG-KO", phrase: "Okene" },
  { stateId: "NG-KO", phrase: "Idah" },
  { stateId: "NG-KO", phrase: "Ankpa" },
  { stateId: "NG-BE", phrase: "Otukpo" },
  { stateId: "NG-BE", phrase: "Gboko" },
  { stateId: "NG-AD", phrase: "Mubi" },
  { stateId: "NG-YO", phrase: "Potiskum" },
  { stateId: "NG-BA", phrase: "Azare" },
  { stateId: "NG-JI", phrase: "Hadejia" },
  { stateId: "NG-NI", phrase: "Minna" },
  { stateId: "NG-NI", phrase: "Bida" },
  { stateId: "NG-NI", phrase: "Kontagora" },
  { stateId: "NG-NI", phrase: "Suleja" },
  { stateId: "NG-TA", phrase: "Wukari" },
  { stateId: "NG-CR", phrase: "Ogoja" },
  { stateId: "NG-CR", phrase: "Ikom" },
  { stateId: "NG-AK", phrase: "Ikot Ekpene" },
  { stateId: "NG-AK", phrase: "Eket" },
  { stateId: "NG-NA", phrase: "Keffi" },
  { stateId: "NG-NA", phrase: "Akwanga" },
];

const gazetteer = lgaData as GazetteerEntry[];

const LGA_BY_STATE = new Map<string, GazetteerEntry[]>();
const LGA_STATES_BY_NAME = new Map<string, Set<string>>();

for (const entry of gazetteer) {
  const normalized = normalizeForMatch(entry.name);
  if (!normalized) continue;
  const list = LGA_BY_STATE.get(entry.stateId) ?? [];
  list.push(entry);
  LGA_BY_STATE.set(entry.stateId, list);
  const states = LGA_STATES_BY_NAME.get(normalized) ?? new Set<string>();
  states.add(entry.stateId);
  LGA_STATES_BY_NAME.set(normalized, states);
}

const STATE_ALIASES: StateAlias[] = [];
const CITY_ALIASES_NORMALIZED: { stateId: string; phrase: string; normalized: string }[] = [];
const STATE_NAME_BY_ID = new Map(STATES.map((state) => [state.id, state.name]));

for (const state of STATES) {
  const seenPhrases = new Set<string>();
  const add = (phrase: string, kind: StateAlias["kind"]) => {
    const normalized = normalizeForMatch(phrase);
    if (!normalized || seenPhrases.has(normalized)) return;
    // "Niger" is handled separately because it is also a country name.
    if (normalized === "niger") return;
    seenPhrases.add(normalized);
    STATE_ALIASES.push({ stateId: state.id, phrase, kind });
  };
  add(state.name, "state");
  if (state.id === "NG-FC") {
    add("FCT", "alias");
    add("Federal Capital Territory", "alias");
    add("Abuja", "alias");
  } else {
    add(state.capital, "capital");
  }
}

for (const alias of CITY_ALIASES) {
  const normalized = normalizeForMatch(alias.phrase);
  if (normalized.length < 4) continue;
  CITY_ALIASES_NORMALIZED.push({ ...alias, normalized });
}

// The phrase "Niger" alone is ambiguous (Niger State vs Republic of Niger vs
// Niger Delta). Only an explicit state signal counts.
const NIGER_STATE_SIGNALS = ["niger state", "minna", "bida", "kontagora", "suleja", "chanchaga"];
const NIGER_NON_STATE_SIGNALS = [
  "niger delta",
  "niger republic",
  "republic of niger",
  "niamey",
  "nigerien",
];

function nigerStateMentioned(normalized: string): boolean {
  if (!containsPhrase(normalized, "niger")) return false;
  if (NIGER_STATE_SIGNALS.some((phrase) => containsPhrase(normalized, phrase))) return true;
  if (NIGER_NON_STATE_SIGNALS.some((phrase) => containsPhrase(normalized, phrase))) return false;
  return false;
}

function zoneForState(stateId: string): ZoneId | null {
  return STATES.find((state) => state.id === stateId)?.zone ?? null;
}

/**
 * Resolves state and LGA evidence without inventing precision. Multiple
 * states, duplicate LGA names and country/state homonyms all resolve to an
 * explicit ambiguity instead of a guess.
 */
export function classifyGeography(
  title: string,
  categories: readonly string[],
  excerpt: string,
): GeographyPrior {
  const titleText = normalizeForMatch(title);
  const tagText = normalizeForMatch(categories.join(" "));
  const excerptText = normalizeForMatch(excerpt);
  const combined = `${titleText} ${tagText} ${excerptText}`;

  const stateSignals = new Map<string, Set<string>>();
  const matches: string[] = [];
  const addSignal = (stateId: string, label: string) => {
    const set = stateSignals.get(stateId) ?? new Set<string>();
    set.add(label);
    stateSignals.set(stateId, set);
    if (!matches.includes(label)) matches.push(label);
  };

  for (const alias of STATE_ALIASES) {
    const normalized = normalizeForMatch(alias.phrase);
    if (!normalized) continue;
    // "Niger Delta" is a multi-state region, not Delta State. Only an explicit
    // "Delta State" or another Delta signal should resolve to NG-DE.
    if (
      alias.stateId === "NG-DE" &&
      normalized === "delta" &&
      containsPhrase(combined, "niger delta") &&
      !containsPhrase(combined, "delta state")
    ) {
      continue;
    }
    if (containsPhrase(combined, normalized)) {
      addSignal(alias.stateId, `${alias.kind}:${alias.phrase}`);
    }
  }

  if (nigerStateMentioned(combined)) {
    addSignal("NG-NI", "state:Niger State");
  }

  for (const city of CITY_ALIASES_NORMALIZED) {
    if (containsPhrase(combined, city.normalized)) {
      addSignal(city.stateId, `city:${city.phrase}`);
    }
  }

  const nigeriaMentioned =
    containsPhrase(combined, "nigeria") ||
    containsPhrase(combined, "nigerian") ||
    containsPhrase(combined, "nigerians");

  // Refine with an LGA only when its state is already established.
  for (const [stateId, entries] of LGA_BY_STATE) {
    if (!stateSignals.has(stateId)) continue;
    for (const entry of entries) {
      const normalized = normalizeForMatch(entry.name);
      if (normalized.length >= 4 && containsPhrase(combined, normalized)) {
        addSignal(stateId, `lga:${entry.name}`);
      }
    }
  }

  // A unique LGA can stand in for a missing state, but only when the name is
  // long enough to avoid ordinary-word collisions and belongs to one state.
  if (stateSignals.size === 0) {
    for (const [name, stateIds] of LGA_STATES_BY_NAME) {
      if (name.length < 6 || stateIds.size !== 1) continue;
      if (!containsPhrase(combined, name)) continue;
      const stateId = [...stateIds][0];
      if (!stateId) continue;
      const original = gazetteer.find(
        (entry) => entry.stateId === stateId && normalizeForMatch(entry.name) === name,
      );
      if (original) addSignal(stateId, `lga:${original.name}`);
    }
  }

  const stateIds = [...stateSignals.keys()];
  if (stateIds.length > 1) {
    const names = stateIds
      .map((id) => STATE_NAME_BY_ID.get(id) ?? id)
      .sort((a, b) => a.localeCompare(b));
    return {
      stateId: null,
      lga: null,
      confidence: 0.3,
      matches,
      ambiguous: true,
      multipleStates: names,
      nigeriaMentioned,
    };
  }

  if (stateIds.length === 0) {
    return {
      stateId: null,
      lga: null,
      confidence: 0,
      matches,
      ambiguous: false,
      multipleStates: [],
      nigeriaMentioned,
    };
  }

  const stateId = stateIds[0] as string;
  const signals = stateSignals.get(stateId) ?? new Set<string>();
  const kinds = [...signals].map((signal) => signal.slice(0, signal.indexOf(":")));
  const lgaSignals = [...signals].filter((signal) => signal.startsWith("lga:"));
  const lga =
    lgaSignals.length === 1
      ? (lgaSignals[0]?.slice("lga:".length) ?? null)
      : null;

  let confidence: number;
  if (kinds.includes("state") || kinds.includes("alias")) confidence = 0.85;
  else if (kinds.includes("capital")) confidence = 0.75;
  else if (kinds.includes("city")) confidence = 0.7;
  else confidence = 0.6;

  if (lga) confidence += 0.03;
  if (signals.size > 1) confidence += 0.02;

  // The LGA-only path is intentionally below the auto-proposal threshold.
  const zone = zoneForState(stateId);
  if (zone) matches.push(`zone:${zone}`);

  return {
    stateId,
    lga,
    confidence: round2(Math.min(0.92, confidence)),
    matches,
    ambiguous: false,
    multipleStates: [],
    nigeriaMentioned,
  };
}

/**
 * Converts priors into a review candidate. Only a clear category and a single
 * unambiguous state can be `pending`; every unresolved case is `needs_review`.
 * Nothing here can produce an event or an accepted candidate.
 */
export function proposeCandidate(
  category: CategoryPrior,
  geography: GeographyPrior,
): CandidateProposal {
  const reasons: string[] = [];
  reasons.push(`category:${category.category ?? "unresolved"}`);
  reasons.push(...category.matches.slice(0, 4));
  reasons.push(`state:${geography.stateId ?? "unresolved"}`);
  reasons.push(...geography.matches.slice(0, 6));
  reasons.push(geography.nigeriaMentioned ? "nigeria-mentioned" : "nigeria-not-mentioned");

  if (category.ambiguous) reasons.push("category-ambiguous");
  if (geography.ambiguous) reasons.push(`multiple-states:${geography.multipleStates.join("|")}`);

  let status: CandidateProposal["status"] = "pending";
  if (geography.ambiguous) status = "needs_review";
  else if (!geography.stateId) status = "needs_review";
  else if (!category.category) status = "needs_review";
  else if (category.confidence < 0.55) status = "needs_review";
  else if (geography.confidence < 0.65) status = "needs_review";

  if (status === "needs_review") {
    if (!category.category) reasons.push("review:category-not-identified");
    if (!geography.stateId) reasons.push("review:state-not-identified");
    if (category.confidence > 0 && category.confidence < 0.55) {
      reasons.push("review:low-category-confidence");
    }
    if (geography.confidence > 0 && geography.confidence < 0.65) {
      reasons.push("review:low-geography-confidence");
    }
  }

  return {
    category: category.category,
    stateId: geography.stateId,
    lga: geography.lga,
    categoryConfidence: category.confidence,
    geoConfidence: geography.confidence,
    status,
    rejectionReason: null,
    reasons,
    ruleVersion: PRIOR_RULE_VERSION,
  };
}
