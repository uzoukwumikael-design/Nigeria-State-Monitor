import { describe, expect, it } from "vitest";
import { clampExcerpt, displaySummary, publishedExcerptLimit } from "./excerpt";

describe("publishedExcerptLimit", () => {
  it("defaults to no publisher text and accepts 0-400", () => {
    expect(publishedExcerptLimit({})).toBe(0);
    expect(publishedExcerptLimit({ PUBLISHED_EXCERPT_CHARS: " 160 " })).toBe(160);
    expect(publishedExcerptLimit({ PUBLISHED_EXCERPT_CHARS: "400" })).toBe(400);
  });

  it("rejects values that could silently publish more than intended", () => {
    for (const bad of ["-1", "401", "1.5", "lots"]) {
      expect(() => publishedExcerptLimit({ PUBLISHED_EXCERPT_CHARS: bad })).toThrow(/between 0 and 400/);
    }
  });
});

describe("clampExcerpt", () => {
  const text = "Heavy rain flooded parts of Owerri in Imo State on Sunday, displacing hundreds of residents from their homes.";

  it("returns nothing at a limit of zero and the whole text when it already fits", () => {
    expect(clampExcerpt(text, 0)).toBe("");
    expect(clampExcerpt("Short text.", 50)).toBe("Short text.");
  });

  it("cuts at a word boundary, never exceeds the limit and marks the cut", () => {
    const out = clampExcerpt(text, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("collapses whitespace", () => {
    expect(clampExcerpt("  A   spaced\n\nout   line  ", 50)).toBe("A spaced out line");
  });
});

describe("displaySummary", () => {
  it("shows the headline when no excerpt is allowed, and a clamped excerpt when it is", () => {
    expect(displaySummary("Publisher excerpt text here.", "The Headline", 0)).toBe("The Headline");
    expect(displaySummary("Publisher excerpt text here.", "The Headline", 12)).toBe("Publisher…");
    expect(displaySummary("", "The Headline", 100)).toBe("The Headline");
  });
});
