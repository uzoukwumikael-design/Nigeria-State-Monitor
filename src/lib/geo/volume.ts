/**
 * Neutral blue ramp for reported-event volume. It is intentionally not a
 * red/green risk scale: reporting volume is not incidence or safety.
 */
export const VOLUME_RAMP = [
  { min: 0, color: "#0b1524", label: "0" },
  { min: 1, color: "#10304a", label: "1" },
  { min: 3, color: "#144a68", label: "3" },
  { min: 5, color: "#1a6688", label: "5" },
  { min: 7, color: "#2187aa", label: "7+" },
] as const;

export function volumeColor(count: number): string {
  if (count <= 0) return VOLUME_RAMP[0].color;
  if (count === 1) return VOLUME_RAMP[1].color;
  if (count <= 3) return VOLUME_RAMP[2].color;
  if (count <= 5) return VOLUME_RAMP[3].color;
  return VOLUME_RAMP[4].color;
}

export const NIGERIA_FIT_BOUNDS: [[number, number], [number, number]] = [
  [2.65, 4.2],
  [14.75, 14.05],
];
