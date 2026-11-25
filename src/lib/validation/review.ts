import { z } from "zod";
import { STATE_BY_ID } from "@/lib/geo/states";
import { CATEGORY_IDS, VERIFICATION_STATUSES } from "@/lib/types";
import { REVIEWER_ID_PATTERN } from "@/lib/review/decide";

const reviewerIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(REVIEWER_ID_PATTERN, "Reviewer ID must be 3–64 lowercase letters, digits, dots or hyphens.");

const reviewerSecretSchema = z
  .string()
  .min(1, "A reviewer secret is required.")
  .max(512, "The reviewer secret is too long.");

const stateIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => STATE_BY_ID.has(value), { message: "Unknown state identifier." });

const notesSchema = z
  .string()
  .max(1_000, "Notes must be 1000 characters or fewer.")
  .optional();

export const reviewerLoginSchema = z.object({
  reviewerId: reviewerIdSchema,
  secret: reviewerSecretSchema,
});

export const reviewQueueQuerySchema = z.object({
  status: z.enum(["open", "pending", "needs_review", "accepted", "rejected"]).default("open"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const candidateDecisionSchema = z.object({
  action: z.enum(["accept", "reject"]),
  category: z.enum(CATEGORY_IDS).optional(),
  stateId: stateIdSchema.optional(),
  notes: notesSchema,
});

export const clusterQueueQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "all"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const clusterDecisionSchema = z.object({
  action: z.enum(["accept", "reject"]),
  notes: z
    .string()
    .trim()
    .min(10, "Cluster review notes must be at least 10 characters.")
    .max(1_000, "Cluster review notes must be 1000 characters or fewer."),
});

export const clusterScanSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const publicationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const publicationSchema = z.object({
  severity: z.coerce.number().int().min(1).max(5),
  rationale: z
    .string()
    .trim()
    .min(10, "A severity rationale of at least 10 characters is required.")
    .max(500, "The severity rationale must be 500 characters or fewer."),
});

export const verificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const transitionTargets = VERIFICATION_STATUSES.filter((status) => status !== "unassessed");

export const verificationTransitionSchema = z.object({
  target: z.enum(transitionTargets as [string, ...string[]]),
  rationale: z
    .string()
    .trim()
    .min(10, "A transition rationale of at least 10 characters is required.")
    .max(1_000, "The transition rationale must be 1000 characters or fewer."),
  approveCorroboration: z.boolean().optional(),
});
