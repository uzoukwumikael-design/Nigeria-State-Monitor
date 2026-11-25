import { describe, expect, it } from "vitest";
import { STATE_IDS_BY_ZONE, STATES, STATE_BY_ID, stateById, stateByName, statesInZone } from "@/lib/geo/states";
import { ZONE_IDS } from "@/lib/types";

describe("state registry", () => {
  it("contains all 36 states and the Federal Capital Territory", () => {
    expect(STATES).toHaveLength(37);
    expect(STATE_BY_ID.size).toBe(37);
    expect(STATE_BY_ID.has("NG-FC")).toBe(true);
  });

  it("uses unique NG-XX identifiers", () => {
    const ids = STATES.map((state) => state.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^NG-[A-Z]{2}$/);
    expect(ids).toContain("NG-AB");
    expect(ids).toContain("NG-ZA");
  });

  it("assigns every state to one of the six zones", () => {
    for (const state of STATES) expect(ZONE_IDS).toContain(state.zone);
    const total = ZONE_IDS.reduce((sum, zone) => sum + statesInZone(zone).length, 0);
    expect(total).toBe(37);
    expect(STATE_IDS_BY_ZONE["north-central"]).toContain("NG-FC");
    for (const zone of ZONE_IDS) {
      expect(statesInZone(zone).length).toBeGreaterThanOrEqual(3);
      expect(STATE_IDS_BY_ZONE[zone].length).toBe(statesInZone(zone).length);
    }
  });

  it("has plausible areas and interior label points", () => {
    const totalArea = STATES.reduce((sum, state) => sum + state.areaKm2, 0);
    expect(totalArea).toBeGreaterThan(900_000);
    expect(totalArea).toBeLessThan(930_000);
    for (const state of STATES) {
      expect(state.areaKm2).toBeGreaterThan(0);
      expect(state.labelPoint.lng).toBeGreaterThanOrEqual(state.bbox.minLng);
      expect(state.labelPoint.lng).toBeLessThanOrEqual(state.bbox.maxLng);
      expect(state.labelPoint.lat).toBeGreaterThanOrEqual(state.bbox.minLat);
      expect(state.labelPoint.lat).toBeLessThanOrEqual(state.bbox.maxLat);
      expect(state.capital.length).toBeGreaterThan(0);
      expect(state.zoneName.length).toBeGreaterThan(0);
    }
  });

  it("resolves names and aliases without inventing states", () => {
    expect(stateByName("Lagos")?.id).toBe("NG-LA");
    expect(stateByName("abuja")?.id).toBe("NG-FC");
    expect(stateByName("FCT")?.id).toBe("NG-FC");
    expect(stateById("NG-FC")?.name).toBe("Federal Capital Territory");
    expect(stateById("NG-XX")).toBeNull();
    expect(stateById(null)).toBeNull();
  });
});
