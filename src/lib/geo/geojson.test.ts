import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STATES } from "@/lib/geo/states";

interface GeoFeature {
  type: "Feature";
  properties: { id?: string; name?: string; zone?: string };
  geometry: { type: string; coordinates: unknown };
}

function readGeoJson(): { type: string; features: GeoFeature[] } {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "public/data/nigeria-states.geojson"), "utf8"),
  ) as { type: string; features: GeoFeature[] };
}

function readSvgMap(): {
  width: number;
  height: number;
  projection: { scale: number; padding: number };
  states: Array<{ id: string; path: string; label: [number, number, number] }>;
} {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "public/data/nigeria-svg-map.json"), "utf8"),
  ) as {
    width: number;
    height: number;
    projection: { scale: number; padding: number };
    states: Array<{ id: string; path: string; label: [number, number, number] }>;
  };
}

function walkCoordinates(value: unknown, visit: (lng: number, lat: number) => void): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value[0], value[1]);
    return;
  }
  for (const child of value) walkCoordinates(child, visit);
}

describe("authoritative map assets", () => {
  it("serves 37 first-order features matching the registry", () => {
    const geo = readGeoJson();
    expect(geo.type).toBe("FeatureCollection");
    expect(geo.features).toHaveLength(37);
    const ids = geo.features.map((feature) => feature.properties.id);
    expect(new Set(ids).size).toBe(37);
    expect(new Set(ids)).toEqual(new Set(STATES.map((state) => state.id)));
    for (const feature of geo.features) {
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
    }
  });

  it("keeps every coordinate within Nigeria's longitude/latitude envelope", () => {
    const geo = readGeoJson();
    let points = 0;
    for (const feature of geo.features) {
      walkCoordinates(feature.geometry.coordinates, (lng, lat) => {
        points += 1;
        expect(Number.isFinite(lng)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        expect(lng).toBeGreaterThan(2.5);
        expect(lng).toBeLessThan(15);
        expect(lat).toBeGreaterThan(4);
        expect(lat).toBeLessThan(14.2);
      });
    }
    expect(points).toBeGreaterThan(10_000);
  });

  it("ships an inline SVG map with the same 37 identifiers", () => {
    const svg = readSvgMap();
    expect(svg.states).toHaveLength(37);
    expect(new Set(svg.states.map((state) => state.id))).toEqual(
      new Set(STATES.map((state) => state.id)),
    );
    expect(svg.width).toBeGreaterThan(100);
    expect(svg.height).toBeGreaterThan(100);
    expect(svg.projection.scale).toBeGreaterThan(0);
    for (const state of svg.states) {
      expect(state.path.length).toBeGreaterThan(20);
      expect(state.path.startsWith("M")).toBe(true);
      const [labelX, labelY, areaKm2] = state.label;
      expect(Number.isFinite(labelX)).toBe(true);
      expect(Number.isFinite(labelY)).toBe(true);
      expect(areaKm2).toBeGreaterThan(0);
    }
  });
});
