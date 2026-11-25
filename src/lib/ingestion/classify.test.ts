import { describe, expect, it } from "vitest";
import {
  PRIOR_RULE_VERSION,
  classifyCategory,
  classifyGeography,
  proposeCandidate,
} from "@/lib/ingestion/classify";

function proposal(title: string, categories: string[] = [], excerpt = "") {
  return proposeCandidate(
    classifyCategory(title, categories, excerpt),
    classifyGeography(title, categories, excerpt),
  );
}

describe("deterministic category priors", () => {
  it("classifies a clear security headline", () => {
    const prior = classifyCategory(
      "Gunmen abduct Plateau varsity student",
      ["More News", "North Central"],
      "The student was freed after a ransom demand.",
    );
    expect(prior.category).toBe("security");
    expect(prior.confidence).toBeGreaterThanOrEqual(0.55);
    expect(prior.matches.some((match) => match.startsWith("security:"))).toBe(true);
  });

  it("classifies economy and health headlines from tags and excerpt", () => {
    const economy = classifyCategory(
      "Cost of living rises again",
      ["Inflation", "Nigeria economy"],
      "The naira weakened as fuel prices increased.",
    );
    expect(economy.category).toBe("economy");

    const health = classifyCategory(
      "State records new cases",
      ["Health"],
      "The cholera outbreak has infected dozens of patients, the hospital said.",
    );
    expect(health.category).toBe("health");
  });

  it("returns no category when evidence is weak or balanced", () => {
    expect(classifyCategory("Residents celebrate annual festival", [], "").category).toBeNull();
    const balanced = classifyCategory(
      "Court orders police to release suspect",
      [],
      "",
    );
    expect(balanced.category).toBeNull();
    expect(balanced.ambiguous).toBe(true);
  });
});

describe("deterministic geography priors", () => {
  it("resolves a single state named in the headline", () => {
    const prior = classifyGeography("Gunmen abduct Plateau varsity student", [], "");
    expect(prior.stateId).toBe("NG-PL");
    expect(prior.ambiguous).toBe(false);
    expect(prior.matches).toContain("state:Plateau");
    expect(prior.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("resolves the FCT from Abuja and its formal name", () => {
    expect(classifyGeography("Flood displaces Abuja residents", [], "").stateId).toBe("NG-FC");
    expect(
      classifyGeography("FCT council approves budget", ["Federal Capital Territory"], "").stateId,
    ).toBe("NG-FC");
  });

  it("resolves a unique LGA only when the state is not named", () => {
    const prior = classifyGeography("Gunmen attack Bokkos community", [], "");
    expect(prior.stateId).toBe("NG-PL");
    expect(prior.lga).toBe("Bokkos");
    expect(prior.confidence).toBeLessThan(0.65);
  });

  it("keeps multiple-state stories ambiguous", () => {
    const prior = classifyGeography(
      "Kaduna and Plateau record new clashes",
      ["Kaduna", "Plateau State"],
      "",
    );
    expect(prior.stateId).toBeNull();
    expect(prior.ambiguous).toBe(true);
    expect(prior.multipleStates).toEqual(["Kaduna", "Plateau"]);
  });

  it("does not confuse Niger State with the Republic of Niger or the Niger Delta", () => {
    expect(classifyGeography("Niger Republic closes its border", [], "").stateId).toBeNull();
    expect(classifyGeography("Niger Delta communities seek clean-up", [], "").stateId).toBeNull();
    expect(classifyGeography("Nigerian traders return home", [], "").stateId).toBeNull();
    expect(classifyGeography("Niger State government budgets for roads", [], "").stateId).toBe(
      "NG-NI",
    );
  });

  it("does not map foreign Bali to Bali LGA in Taraba", () => {
    const prior = classifyGeography("Tourists return to Bali in Indonesia", [], "");
    expect(prior.stateId).toBeNull();
  });

  it("recognises Nigeria without inventing a state", () => {
    const prior = classifyGeography("Nigerians react to the new policy", [], "");
    expect(prior.stateId).toBeNull();
    expect(prior.nigeriaMentioned).toBe(true);
  });
});

describe("candidate proposals", () => {
  it("maps a clear security story to a pending review candidate", () => {
    const result = proposal("Gunmen abduct Plateau varsity student", ["Plateau State"]);
    expect(result).toMatchObject({
      category: "security",
      stateId: "NG-PL",
      status: "pending",
      rejectionReason: null,
      ruleVersion: PRIOR_RULE_VERSION,
    });
    expect(result.categoryConfidence).toBeGreaterThanOrEqual(0.55);
    expect(result.geoConfidence).toBeGreaterThanOrEqual(0.65);
  });

  it("sends ambiguous geography to review instead of choosing a state", () => {
    const result = proposal("Kaduna and Plateau record new clashes");
    expect(result.status).toBe("needs_review");
    expect(result.stateId).toBeNull();
    expect(result.reasons.some((reason) => reason.startsWith("multiple-states:"))).toBe(true);
  });

  it("sends unresolved categories or geography to review", () => {
    expect(proposal("Residents celebrate annual festival").status).toBe("needs_review");
    expect(proposal("Gunmen attack Bokkos community").status).toBe("needs_review");
  });

  it("never accepts a candidate automatically", () => {
    for (const title of [
      "Gunmen abduct Plateau varsity student",
      "Inflation rises in Kano",
      "Flood displaces Abuja residents",
      "Residents celebrate annual festival",
    ]) {
      expect(proposal(title).status).not.toBe("accepted");
    }
  });
});
