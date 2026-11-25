import { z } from "zod";
import { INDICATOR_BY_CODE } from "@/lib/economy/indicators";

export const economyTrendQuerySchema = z.object({
  code: z
    .string()
    .trim()
    .refine((value) => INDICATOR_BY_CODE.has(value), "Unknown indicator code"),
  years: z.coerce.number().int().min(2).max(60).default(30),
});
