import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_ACTOR,
  autopilotConfigFromEnv,
  deriveSeverity,
  evaluateCandidate,
  type AutopilotCandidate,
} from "./rules";
import { REVIEWER_ID_PATTERN } from "@/lib/review/decide";

const base: AutopilotCandidate = {
  publicId: "cand-1",
  category: "environment",
  stateId: "NG-IM",
  categoryConfidence: 0.8,
  geoConfidence: 0.9,
  title: "Flood displaces residents in Owerri",
  excerpt: "Heavy rain flooded parts of Owerri.",
};

describe("autopilot identity and config", () => {
  it("uses an actor ID the review and publication stores accept, and that is clearly not a person", () => {
    expect(REVIEWER_ID_PATTERN.test(AUTOPILOT_ACTOR)).toBe(true);
    expect(AUTOPILOT_ACTOR.startsWith("system.")).toBe(true);
  });

  it("is on by default, has a kill switch, and rejects nonsense thresholds", () => {
    expect(autopilotConfigFromEnv({}).enabled).toBe(true);
    for (const off of ["off", "OFF", "false", "0"]) expect(autopilotConfigFromEnv({ AUTOPUBLISH: off }).enabled).toBe(false);
    expect(autopilotConfigFromEnv({ AUTOPUBLISH_MAX_PER_RUN: "10" }).maxPerRun).toBe(10);
    expect(() => autopilotConfigFromEnv({ AUTOPUBLISH_MIN_GEO_CONFIDENCE: "2" })).toThrow(/between 0 and 1/);
    expect(() => autopilotConfigFromEnv({ AUTOPUBLISH_MAX_PER_RUN: "abc" })).toThrow();
  });
});

describe("deriveSeverity", () => {
  it("caps software-assigned severity at 3 and explains it", () => {
    const grave = deriveSeverity("Gunmen kill 20 in massacre", "Dozens died in the attack.", "security");
    expect(grave.severity).toBe(3);
    expect(grave.reason).toMatch(/reported impact term/);
  });

  it("uses 1 for routine politics and economy and 2 otherwise", () => {
    expect(deriveSeverity("Senate debates budget", "A routine sitting.", "politics").severity).toBe(1);
    expect(deriveSeverity("Port opens bids", "A tender.", "economy").severity).toBe(1);
    expect(deriveSeverity("Council begins road repairs", "Work started.", "infrastructure").severity).toBe(2);
  });
});

describe("evaluateCandidate", () => {
  it("publishes a confident, resolved candidate with a labelled automatic rationale", () => {
    const decision = evaluateCandidate(base, null);
    expect(decision).toMatchObject({ action: "publish", category: "environment", stateId: "NG-IM", classifier: "rules", severity: 3 });
    if (decision.action === "publish") {
      expect(decision.severityRationale).toMatch(/not assessed by a person/);
      expect(decision.notes).toMatch(/Not reviewed by a person/);
    }
  });

  it("skips opinion pieces, unresolved candidates and low-confidence ones", () => {
    expect(evaluateCandidate({ ...base, title: "Opinion: why floods keep happening" }, null)).toMatchObject({ action: "skip", reason: "opinion" });
    expect(evaluateCandidate({ ...base, stateId: null }, null)).toMatchObject({ action: "skip", reason: "unresolved" });
    expect(evaluateCandidate({ ...base, category: null }, null)).toMatchObject({ action: "skip", reason: "unresolved" });
    expect(evaluateCandidate({ ...base, geoConfidence: 0.3 }, null)).toMatchObject({ action: "skip", reason: "low_confidence" });
    expect(evaluateCandidate({ ...base, categoryConfidence: 0.2 }, null)).toMatchObject({ action: "skip", reason: "low_confidence" });
  });

  it("uses a confident AI proposal to resolve what the rules could not", () => {
    const decision = evaluateCandidate(
      { ...base, title: "Senate debates budget amendment", excerpt: "A routine sitting in Abuja.", category: null, stateId: null, categoryConfidence: 0, geoConfidence: 0 },
      { category: "politics", stateId: "NG-FC", confidence: 0.9 },
    );
    expect(decision).toMatchObject({ action: "publish", category: "politics", stateId: "NG-FC", classifier: "ai", severity: 1 });
  });

  it("labels agreement between AI and rules, and refuses to publish when they disagree", () => {
    expect(evaluateCandidate(base, { category: "environment", stateId: "NG-IM", confidence: 0.9 })).toMatchObject({ action: "publish", classifier: "ai+rules" });
    expect(evaluateCandidate(base, { category: "security", stateId: "NG-IM", confidence: 0.95 })).toMatchObject({ action: "skip", reason: "ai_disagrees" });
    expect(evaluateCandidate(base, { category: "environment", stateId: "NG-LA", confidence: 0.95 })).toMatchObject({ action: "skip", reason: "ai_disagrees" });
  });

  it("ignores a low-confidence or invalid AI proposal", () => {
    expect(evaluateCandidate(base, { category: "security", stateId: "NG-LA", confidence: 0.4 })).toMatchObject({ action: "publish", classifier: "rules", category: "environment" });
    expect(evaluateCandidate({ ...base, stateId: null }, { category: "security", stateId: "NG-XX", confidence: 0.99 })).toMatchObject({ action: "skip" });
  });
});
