import { describe, expect, it } from "vitest";
import { economyTrendQuerySchema } from "@/lib/validation/economy";
import { eventQuerySchema } from "@/lib/validation/query";

describe("eventQuerySchema", () => {
  it("accepts ordinary filters and applies defaults", () => {
    const parsed = eventQuerySchema.parse({ state: "ng-la", category: "economy" });
    expect(parsed.state).toBe("NG-LA");
    expect(parsed.window).toBe("30d");
    expect(parsed.limit).toBe(25);
  });

  it("rejects from/to rather than silently ignoring a date filter", () => {
    const result = eventQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-10" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(/\/api\/intelligence\/history/);
    }
    expect(eventQuerySchema.safeParse({ from: "2026-10-01" }).success).toBe(false);
  });
});

describe("economyTrendQuerySchema", () => {
  it("accepts a curated code and bounds the number of years", () => {
    expect(economyTrendQuerySchema.parse({ code: "FP.CPI.TOTL.ZG" }).years).toBe(30);
    expect(economyTrendQuerySchema.safeParse({ code: "FP.CPI.TOTL.ZG", years: "5" }).success).toBe(true);
    expect(economyTrendQuerySchema.safeParse({ code: "FP.CPI.TOTL.ZG", years: "1" }).success).toBe(false);
    expect(economyTrendQuerySchema.safeParse({ code: "FP.CPI.TOTL.ZG", years: "61" }).success).toBe(false);
  });

  it("rejects codes outside the curated list", () => {
    expect(economyTrendQuerySchema.safeParse({ code: "SP.POP.TOTL" }).success).toBe(false);
    expect(economyTrendQuerySchema.safeParse({}).success).toBe(false);
  });
});
