import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ParsedRssFeed, ParsedRssItem } from "@/lib/ingestion/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
  cdataPropName: false,
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(text).find(Boolean) ?? "";
  const object = record(value);
  if (!object) return "";
  return text(object["#text"]);
}

/**
 * Parses RSS 2.0 only. It rejects DTDs and entity declarations: the adapter
 * does not need them and they widen the XML attack surface.
 */
export function parseRssFeed(xml: string, maxItems: number): ParsedRssFeed {
  if (!xml.trim()) throw new Error("Feed response is empty.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Feed contains a DTD or entity declaration, which is not accepted.");
  }

  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (validation !== true) {
    const message = validation.err?.msg ?? "unknown XML error";
    throw new Error(`Feed is not well-formed XML: ${message}`);
  }

  const document = record(parser.parse(xml));
  const rss = record(document?.rss);
  const channel = record(rss?.channel);
  if (!channel) {
    throw new Error("Feed is not RSS 2.0: missing rss/channel.");
  }

  const rawItems = array(channel.item);
  if (rawItems.length === 0) {
    throw new Error("Feed contains no items.");
  }

  const items: ParsedRssItem[] = [];
  for (const value of rawItems.slice(0, maxItems)) {
    const item = record(value);
    if (!item) continue;
    items.push({
      title: text(item.title),
      link: text(item.link),
      description: text(item.description),
      pubDate: text(item.pubDate) || null,
      categories: array(item.category)
        .map((category) => text(category))
        .filter((category) => category.length > 0),
      guid: text(item.guid) || null,
    });
  }

  if (items.length === 0) {
    throw new Error("Feed contains no readable items.");
  }

  return { title: text(channel.title), items };
}
