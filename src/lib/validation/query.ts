import { z } from "zod";
import {
  CATEGORY_IDS,
  SEVERITIES,
  TIME_WINDOW_IDS,
  VERIFICATION_STATUSES,
  ZONE_IDS,
  type Filters,
} from "@/lib/types";
import { STATE_BY_ID } from "@/lib/geo/states";

const stateIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => STATE_BY_ID.has(value), { message: "Unknown state identifier" });

const DATE_RANGE_MESSAGE = "Custom date ranges are not supported here; use /api/intelligence/history with from and to.";

export const eventQuerySchema = z
  .object({
  from: z.string().optional(),
  to: z.string().optional(),
  state: stateIdSchema.optional(),
  zone: z.enum(ZONE_IDS).optional(),
  category: z.enum(CATEGORY_IDS).optional(),
  severity: z.coerce
    .number()
    .int()
    .refine((value) => (SEVERITIES as readonly number[]).includes(value), {
      message: "Severity must be between 1 and 5",
    })
    .optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  window: z.enum(TIME_WINDOW_IDS).default("30d"),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["latest", "severity", "occurrence"]).default("latest"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((value, ctx) => {
    // Never silently ignore a date filter the caller believes was applied.
    if (value.from !== undefined) ctx.addIssue({ code: "custom", message: DATE_RANGE_MESSAGE, path: ["from"] });
    if (value.to !== undefined) ctx.addIssue({ code: "custom", message: DATE_RANGE_MESSAGE, path: ["to"] });
  });

export type EventQuery = z.infer<typeof eventQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Enter at least 2 characters").max(120),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export const trendsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(14),
  state: stateIdSchema.optional(),
  zone: z.enum(ZONE_IDS).optional(),
  category: z.enum(CATEGORY_IDS).optional(),
  severity: z.coerce
    .number()
    .int()
    .refine((value) => (SEVERITIES as readonly number[]).includes(value), {
      message: "Severity must be between 1 and 5",
    })
    .optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
});

export const regionalQuerySchema = z.object({
  zone: z.enum(ZONE_IDS).optional(),
  category: z.enum(CATEGORY_IDS).optional(),
  severity: z.coerce
    .number()
    .int()
    .refine((value) => (SEVERITIES as readonly number[]).includes(value), {
      message: "Severity must be between 1 and 5",
    })
    .optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  window: z.enum(TIME_WINDOW_IDS).default("30d"),
  q: z.string().trim().max(120).optional(),
  days: z.coerce.number().int().min(7).max(90).default(14),
});

export type RegionalQuery = z.infer<typeof regionalQuerySchema>;

export function queryToFilters(query: Partial<EventQuery>): Filters {
  return {
    category: query.category ?? "all",
    zone: query.zone ?? "all",
    stateId: query.state ?? null,
    severity: (query.severity ?? "all") as Filters["severity"],
    verification: query.verification ?? "all",
    window: query.window ?? "30d",
    q: query.q ?? "",
  };
}

export function flattenZodError(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    const messages = result[key] ?? [];
    messages.push(issue.message);
    result[key] = messages;
  }
  return result;
}

export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  params: URLSearchParams,
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    raw[key] = value;
  }
  const result = schema.safeParse(raw);
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data };
}

export const historyQuerySchema = z
  .object({
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    window: z.enum(TIME_WINDOW_IDS).optional(),
    state: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => STATE_BY_ID.has(value), "Unknown state ID")
      .optional(),
    zone: z.enum(ZONE_IDS).optional(),
    category: z.enum(CATEGORY_IDS).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.from && !value.to) || (!value.from && value.to)) {
      ctx.addIssue({ code: "custom", message: "Provide both from and to, or neither.", path: ["from"] });
    }
    if (value.from && value.window) {
      ctx.addIssue({ code: "custom", message: "Use either a window or a from/to range, not both.", path: ["window"] });
    }
    if (value.state && value.zone) {
      const stateZone = STATE_BY_ID.get(value.state)?.zone;
      if (stateZone !== value.zone) {
        ctx.addIssue({ code: "custom", message: "The state is not in that zone.", path: ["zone"] });
      }
    }
  });
