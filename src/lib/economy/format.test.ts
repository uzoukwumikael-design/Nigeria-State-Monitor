import { describe, expect, it } from "vitest";
import { formatIndicatorChange, formatIndicatorValue } from "./format";

const obs = (year: number, value: number) => ({
  year,
  value,
  referencePeriodStart: `${year}-01-01`,
  referencePeriodEnd: `${year}-12-31`,
});

describe("formatIndicatorValue", () => {
  it("formats percentages, rates and compact US dollars by display kind", () => {
    expect(formatIndicatorValue({ display: "percent", decimals: 1 }, 2.34)).toBe("2.3%");
    expect(formatIndicatorValue({ display: "currency-rate", decimals: 2 }, 1500)).toBe("₦1,500.00 / US$");
    expect(formatIndicatorValue({ display: "usd-compact", decimals: 1 }, 3.25e10)).toBe("US$32.5B");
    expect(formatIndicatorValue({ display: "number", decimals: 0 }, 12345)).toBe("12,345");
  });
});

describe("formatIndicatorChange", () => {
  it("uses percentage points for rates and relative percent for levels", () => {
    expect(
      formatIndicatorChange({ display: "percent", decimals: 1, latest: obs(2001, 3), previous: obs(2000, 1) }),
    ).toBe("+2.0 pp vs 2000");
    expect(
      formatIndicatorChange({ display: "currency-rate", decimals: 2, latest: obs(2001, 150), previous: obs(2000, 100) }),
    ).toBe("+50.0% vs 2000");
    expect(
      formatIndicatorChange({ display: "percent", decimals: 1, latest: obs(2001, 1), previous: obs(2000, 3) }),
    ).toBe("−2.0 pp vs 2000");
  });

  it("returns null without two published periods and never divides by zero", () => {
    expect(formatIndicatorChange({ display: "percent", decimals: 1, latest: obs(2001, 3), previous: null })).toBeNull();
    expect(
      formatIndicatorChange({ display: "usd-compact", decimals: 1, latest: obs(2001, 3), previous: obs(2000, 0) }),
    ).toMatch(/no % change/);
  });
});
