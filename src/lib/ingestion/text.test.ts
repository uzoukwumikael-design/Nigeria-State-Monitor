import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  collapseWhitespace,
  containsPhrase,
  countPhrase,
  decodeEntities,
  excerptFromHtml,
  normalizeForMatch,
  stripInvisible,
  truncateText,
} from "@/lib/ingestion/text";

describe("ingestion text helpers", () => {
  it("decodes named, numeric and astral entities exactly once", () => {
    expect(decodeEntities("A &amp; B &#8217;s &#x1F600; &unknown;")).toBe(
      "A & B ’s 😀 &unknown;",
    );
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeEntities("&#0; &#x110000;")).toBe("&#0; &#x110000;");
  });

  it("strips invisible formatting and control characters", () => {
    expect(stripInvisible("Plate\u200Bau\u202E \u0007State\uFEFF")).toBe("Plateau State");
  });

  it("collapses whitespace", () => {
    expect(collapseWhitespace("  a \n\t b  ")).toBe("a b");
  });

  it("converts an RSS description into a bounded plain excerpt", () => {
    const html =
      "<p>First paragraph &amp; detail.</p><!-- hidden --><script>alert(1)</script>" +
      "<p>Second paragraph with a <a href=\"https://example.test\">link</a>.</p>" +
      "<p>The post <strong>Headline</strong> appeared first on <a href=\"#\">Premium Times</a>.</p>";
    const excerpt = excerptFromHtml(html, 120);
    expect(excerpt).toBe("First paragraph & detail. Second paragraph with a link.");
    expect(excerpt).not.toContain("alert");
    expect(excerpt).not.toContain("appeared first on");
    expect(excerpt.length).toBeLessThanOrEqual(120);
  });

  it("never stores more than the excerpt limit", () => {
    const excerpt = excerptFromHtml(`<p>${"word ".repeat(400)}</p>`, 80);
    expect(excerpt.length).toBeLessThanOrEqual(80);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("cleans titles without double decoding", () => {
    expect(cleanTitle("<b>Plateau&amp;#8217;s</b> budget")).toBe("Plateau&#8217;s budget");
    expect(cleanTitle("  A   &amp;  B ")).toBe("A & B");
  });

  it("truncates at a word boundary", () => {
    expect(truncateText("one two three four", 12)).toBe("one two thr…");
    expect(truncateText("short", 12)).toBe("short");
  });

  it("matches phrases on word boundaries", () => {
    const text = normalizeForMatch("Gunmen attack Kogite travellers in Plateau State");
    expect(containsPhrase(text, "Kogi")).toBe(false);
    expect(containsPhrase(text, "Plateau State")).toBe(true);
    expect(countPhrase(text, "Plateau State")).toBe(1);
    expect(countPhrase(text, "gunmen")).toBe(1);
  });
});
