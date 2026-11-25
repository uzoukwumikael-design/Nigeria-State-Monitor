import { describe, expect, it } from "vitest";
import { summariseSourceHealth } from "./source-health";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const src = (isDemo: boolean, lastSuccessfulSync: string | null) => ({ isDemo, lastSuccessfulSync });

describe("summariseSourceHealth", () => {
  it("reports the newest live sync and counts only recently synced live sources as healthy", () => {
    const result = summariseSourceHealth(
      [
        src(false, "2026-11-09T05:00:00.000Z"),
        src(false, "2026-11-01T05:00:00.000Z"),
        src(false, null),
        src(true, "2026-11-09T11:00:00.000Z"),
      ],
      NOW,
    );
    expect(result).toEqual({
      total: 4,
      live: 3,
      demo: 1,
      healthy: 1,
      lastSuccessfulSync: "2026-11-09T05:00:00.000Z",
    });
  });

  it("never lets demo sources look like live sync, and reports null when nothing ever synced", () => {
    const result = summariseSourceHealth([src(true, "2026-11-09T11:00:00.000Z"), src(false, null)], NOW);
    expect(result.lastSuccessfulSync).toBeNull();
    expect(result.healthy).toBe(0);
  });

  it("ignores unparseable and future timestamps for healthy status", () => {
    const result = summariseSourceHealth([src(false, "garbage"), src(false, "2027-01-01T00:00:00.000Z")], NOW);
    expect(result.healthy).toBe(0);
  });
});
