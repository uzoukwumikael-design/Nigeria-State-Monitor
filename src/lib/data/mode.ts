import type { DataMode } from "@/lib/data/types";

export const DATA_MODE: DataMode =
  process.env.NSM_MODE === "production" ? "production" : "demo";
