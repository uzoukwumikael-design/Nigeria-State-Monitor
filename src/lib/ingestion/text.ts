const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  pound: "£",
  euro: "€",
  deg: "°",
  times: "×",
  divide: "÷",
  laquo: "«",
  raquo: "»",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
};

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi;

/**
 * Decodes HTML/XML entities once. Numeric references are resolved with
 * String.fromCodePoint so astral characters survive.
 */
export function decodeEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return safeCodePoint(code, match);
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return safeCodePoint(code, match);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/** Removes invisible formatting characters publishers sometimes inject into titles. */
export function stripInvisible(value: string): string {
  return value
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Converts an RSS description into a short plain-text excerpt. Markup, images,
 * scripts and the publisher's WordPress trailer are removed. The returned text
 * is never treated as full article content.
 */
export function excerptFromHtml(html: string, limit: number): string {
  if (!html) return "";
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const withoutBlocks = withoutComments.replace(
    /<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    " ",
  );
  const withBreaks = withoutBlocks
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\s*\/\s*p\s*>/gi, " ");
  const withoutTags = withBreaks.replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(withoutTags);
  const cleaned = stripInvisible(decoded)
    .replace(/\bADVERTISEMENT\b/gi, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s*The post\s+[\s\S]{0,300}?\s+appeared first on\s+[\s\S]{0,120}?\.?\s*$/i, " ");
  return truncateText(collapseWhitespace(cleaned), limit);
}

export function cleanTitle(raw: string): string {
  if (!raw) return "";
  const withoutTags = raw.replace(/<[^>]*>/g, " ");
  return collapseWhitespace(stripInvisible(decodeEntities(withoutTags)));
}

export function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const slice = value.slice(0, Math.max(0, limit - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const body = lastSpace > Math.floor(limit * 0.6) ? slice.slice(0, lastSpace) : slice;
  return `${body.trimEnd()}…`;
}

/**
 * Normalises text for deterministic phrase matching. Punctuation and
 * apostrophes become spaces, which keeps phrases such as "Ado-Ekiti" and
 * "Plateau's" matchable without regex ambiguity.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function containsPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeForMatch(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

export function countPhrase(normalizedText: string, phrase: string): number {
  const normalizedPhrase = normalizeForMatch(phrase);
  if (!normalizedPhrase) return 0;
  const padded = ` ${normalizedText} `;
  let count = 0;
  let index = padded.indexOf(` ${normalizedPhrase} `);
  while (index !== -1) {
    count += 1;
    index = padded.indexOf(` ${normalizedPhrase} `, index + normalizedPhrase.length + 2);
  }
  return count;
}
