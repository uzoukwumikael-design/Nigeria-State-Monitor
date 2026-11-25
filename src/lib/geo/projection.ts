/**
 * Web Mercator projection shared by the generated lite SVG map and the
 * runtime event/label positioning. The parameters are embedded in
 * /data/nigeria-svg-map.json so map and markers cannot drift apart.
 */
export interface SvgProjection {
  minX: number;
  maxY: number;
  scale: number;
  padding: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

export function mercatorX(lng: number): number {
  return (lng * Math.PI) / 180;
}

export function mercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

export function projectLngLat(lng: number, lat: number, projection: SvgProjection): ProjectedPoint {
  return {
    x: projection.padding + (mercatorX(lng) - projection.minX) * projection.scale,
    y: projection.padding + (projection.maxY - mercatorY(lat)) * projection.scale,
  };
}

export interface SvgState {
  id: string;
  name: string;
  zone: string;
  path: string;
  /** [x, y, areaKm2] in the generated SVG coordinate system. */
  label: [number, number, number];
  /** [x, y] in the generated SVG coordinate system. */
  capital: [number, number];
}

export interface SvgMapData {
  viewBox: string;
  width: number;
  height: number;
  projection: SvgProjection;
  source: string;
  states: SvgState[];
}
