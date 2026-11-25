type Env = Record<string, string | undefined>;

export const MAX_PUBLISHED_EXCERPT_CHARS = 400;

/**
 * How much publisher text may appear on the site. Publishers' terms reserve their content and ask for written
 * permission before reproduction, so the default is none: events show the headline, the outlet and a link.
 * Set PUBLISHED_EXCERPT_CHARS (0-400) to show a short excerpt once you have permission.
 */
export function publishedExcerptLimit(env: Env = process.env): number {
  const raw = env.PUBLISHED_EXCERPT_CHARS?.trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_PUBLISHED_EXCERPT_CHARS) {
    throw new Error(`PUBLISHED_EXCERPT_CHARS must be a whole number between 0 and ${MAX_PUBLISHED_EXCERPT_CHARS}.`);
  }
  return value;
}

/** Trims to at most `limit` characters at a word boundary, adding an ellipsis when something was cut. */
export function clampExcerpt(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (limit <= 0 || !clean) return "";
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, Math.max(limit - 1, 1));
  const boundary = cut.lastIndexOf(" ");
  const base = boundary > limit * 0.5 ? cut.slice(0, boundary) : cut;
  return `${base.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** What the site shows as an event's summary: a clamped excerpt, or the headline when no excerpt is allowed. */
export function displaySummary(summary: string, title: string, limit: number = publishedExcerptLimit()): string {
  return clampExcerpt(summary, limit) || title.replace(/\s+/g, " ").trim();
}
