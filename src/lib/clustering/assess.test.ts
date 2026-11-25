import { describe, expect, it } from "vitest";
import {
  assessClusterPair,
  CLUSTER_TIME_WINDOW_HOURS,
  clusterDecisionForScore,
  type ClusterRecord,
} from "@/lib/clustering";

const AT = "2026-11-06T10:00:00.000Z";

function record(overrides: Partial<ClusterRecord> = {}): ClusterRecord {
  return {
    id: "candidate-1",
    title: "Gunmen abduct Plateau varsity student",
    excerpt: "Security sources said the student was later freed in Plateau State.",
    category: "security",
    stateId: "NG-PL",
    lga: "Jos North",
    publishedAt: AT,
    publisher: "premium-times",
    independenceGroup: "premium-times",
    ...overrides,
  };
}

function existing(overrides: Partial<ClusterRecord> = {}): ClusterRecord {
  return record({
    id: "event-1",
    publisher: "daily-trust",
    independenceGroup: "daily-trust",
    ...overrides,
  });
}

describe("event clustering hard gates", () => {
  it("auto-attaches only when every gate passes and evidence is independent", () => {
    const result = assessClusterPair(record(), existing());

    expect(result.failure).toBeNull();
    expect(result.gates).toEqual({
      distinct: true,
      category: true,
      geography: true,
      time: true,
      lgaConflict: false,
      numericConflict: false,
      independent: true,
    });
    expect(result.decision).toBe("auto_attach");
    expect(result.similarity).toBe(1);
    expect(result.components).toEqual({ title: 1, entity: 1, geography: 1, time: 1 });
    expect(result.reasons.join(" ")).toMatch(/auto-attach/);
  });

  it("refuses to cluster a record with itself", () => {
    const result = assessClusterPair(record(), record({ id: "candidate-1" }));

    expect(result.decision).toBe("no_match");
    expect(result.failure).toBe("same_record");
    expect(result.similarity).toBeNull();
    expect(result.gates.distinct).toBe(false);
  });

  it("requires a resolved category on both records", () => {
    expect(assessClusterPair(record({ category: null }), existing()).failure).toBe(
      "unresolved_category",
    );
    expect(
      assessClusterPair(record(), existing({ category: null })).failure,
    ).toBe("unresolved_category");
  });

  it("requires equal categories", () => {
    const result = assessClusterPair(record(), existing({ category: "politics" }));

    expect(result.failure).toBe("category_mismatch");
    expect(result.gates.category).toBe(false);
    expect(result.similarity).toBeNull();
  });

  it("requires a resolved state on both records", () => {
    expect(assessClusterPair(record({ stateId: null }), existing()).failure).toBe(
      "unresolved_geography",
    );
    expect(assessClusterPair(record(), existing({ stateId: null })).failure).toBe(
      "unresolved_geography",
    );
  });

  it("requires equal states", () => {
    const result = assessClusterPair(record(), existing({ stateId: "NG-KN", lga: "Kano" }));

    expect(result.failure).toBe("geography_mismatch");
    expect(result.gates.geography).toBe(false);
  });

  it("requires valid publication times", () => {
    expect(assessClusterPair(record({ publishedAt: null }), existing()).failure).toBe(
      "invalid_time",
    );
    expect(
      assessClusterPair(record({ publishedAt: "not-a-date" }), existing()).failure,
    ).toBe("invalid_time");
  });

  it("rejects pairs more than 72 hours apart", () => {
    const justOutside = new Date(
      new Date(AT).getTime() + CLUSTER_TIME_WINDOW_HOURS * 3_600_000 + 1,
    ).toISOString();
    const result = assessClusterPair(record(), existing({ publishedAt: justOutside }));

    expect(result.failure).toBe("outside_time_window");
    expect(result.gates.time).toBe(false);
  });

  it("accepts a pair exactly on the 72-hour boundary", () => {
    const boundary = new Date(
      new Date(AT).getTime() + CLUSTER_TIME_WINDOW_HOURS * 3_600_000,
    ).toISOString();
    const result = assessClusterPair(record(), existing({ publishedAt: boundary }));

    expect(result.failure).toBeNull();
    expect(result.gates.time).toBe(true);
    expect(result.components?.time).toBe(0);
    expect(result.similarity).toBe(0.9);
  });

  it("treats an LGA conflict as a review cap, never an automatic merge", () => {
    const result = assessClusterPair(record(), existing({ lga: "Jos South" }));

    expect(result.failure).toBeNull();
    expect(result.gates.lgaConflict).toBe(true);
    expect(result.similarity).toBe(0.8);
    expect(result.decision).toBe("review");
    expect(result.reasons.join(" ")).toMatch(/LGAs differ/);
  });

  it("treats contradictory headline numbers as a review cap", () => {
    const result = assessClusterPair(
      record({ title: "Gunmen kill 5 Plateau varsity students" }),
      existing({ title: "Gunmen kill 7 Plateau varsity students" }),
    );

    expect(result.failure).toBeNull();
    expect(result.gates.numericConflict).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.86);
    expect(result.decision).toBe("review");
    expect(result.reasons.join(" ")).toMatch(/numbers differ/);
  });

  it("does not flag matching or absent numbers as a conflict", () => {
    expect(
      assessClusterPair(
        record({ title: "Gunmen kill 5 Plateau varsity students" }),
        existing({ title: "Gunmen kill 5 Plateau varsity students" }),
      ).gates.numericConflict,
    ).toBe(false);

    expect(
      assessClusterPair(
        record({ title: "Gunmen kill 5 Plateau varsity students" }),
        existing({ title: "Gunmen abduct Plateau varsity students" }),
      ).gates.numericConflict,
    ).toBe(false);
  });

  it("does not treat one known LGA and one unknown LGA as a conflict", () => {
    const result = assessClusterPair(record(), existing({ lga: null }));

    expect(result.failure).toBeNull();
    expect(result.gates.lgaConflict).toBe(false);
    expect(result.components?.geography).toBe(0.8);
    expect(result.decision).toBe("auto_attach");
  });

  it("removes common title words before measuring similarity", () => {
    const result = assessClusterPair(
      record({ title: "Gunmen abduct Plateau varsity student" }),
      existing({ title: "The gunmen abduct the Plateau varsity student" }),
    );

    expect(result.components?.title).toBe(1);
    expect(result.similarity).toBe(1);
  });

  it("scores unrelated headlines as separate even in the same category and state", () => {
    const result = assessClusterPair(
      record(),
      existing({
        title: "Police parade two suspected motorcycle thieves in Jos",
        excerpt: "The police said the suspects were arrested on Friday.",
      }),
    );

    expect(result.failure).toBeNull();
    expect(result.similarity).toBeLessThan(0.7);
    expect(result.decision).toBe("no_match");
  });

  it("decays the time component as reports move apart", () => {
    const later = new Date(new Date(AT).getTime() + 36 * 3_600_000).toISOString();
    const result = assessClusterPair(record(), existing({ publishedAt: later }));

    expect(result.components?.time).toBe(0.5);
    expect(result.similarity).toBe(0.95);
  });

  it("treats the same publisher as non-independent evidence", () => {
    const result = assessClusterPair(
      record(),
      existing({ publisher: "premium-times", independenceGroup: "premium-times" }),
    );

    expect(result.independent).toBe(false);
    expect(result.gates.independent).toBe(false);
    expect(result.decision).toBe("review");
    expect(result.similarity).toBe(1);
    expect(result.reasons.join(" ")).toMatch(/Same publisher/);
  });

  it("treats a shared syndication group as non-independent evidence", () => {
    const result = assessClusterPair(
      record(),
      existing({ publisher: "daily-trust", independenceGroup: "premium-times" }),
    );

    expect(result.independent).toBe(false);
    expect(result.decision).toBe("review");
    expect(result.reasons.join(" ")).toMatch(/independence group/);
  });

  it("does not mutate its inputs", () => {
    const candidate = record();
    const other = existing();
    const candidateBefore = JSON.stringify(candidate);
    const otherBefore = JSON.stringify(other);

    assessClusterPair(candidate, other);

    expect(JSON.stringify(candidate)).toBe(candidateBefore);
    expect(JSON.stringify(other)).toBe(otherBefore);
  });
});

describe("clustering decision thresholds", () => {
  it("uses 0.86 and 0.70 as inclusive boundaries", () => {
    expect(clusterDecisionForScore(0.86)).toBe("auto_attach");
    expect(clusterDecisionForScore(0.859)).toBe("review");
    expect(clusterDecisionForScore(0.7)).toBe("review");
    expect(clusterDecisionForScore(0.699)).toBe("no_match");
  });

  it("never auto-attaches non-independent or conflicting pairs", () => {
    expect(clusterDecisionForScore(1, { independent: false })).toBe("review");
    expect(clusterDecisionForScore(1, { lgaConflict: true })).toBe("review");
    expect(clusterDecisionForScore(1, { numericConflict: true })).toBe("review");
    expect(clusterDecisionForScore(0.65, { lgaConflict: true })).toBe("no_match");
  });

  it("rejects an out-of-range score", () => {
    expect(() => clusterDecisionForScore(-0.01)).toThrow(RangeError);
    expect(() => clusterDecisionForScore(1.01)).toThrow(RangeError);
    expect(() => clusterDecisionForScore(Number.NaN)).toThrow(RangeError);
  });
});
