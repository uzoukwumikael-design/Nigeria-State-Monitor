import type { Category, Severity, SourceTier, VerificationStatus, ZoneId } from "@/lib/types";

export interface CategoryConfig {
  id: Category;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  icon: string;
}

export const CATEGORIES: readonly CategoryConfig[] = [
  {
    id: "security",
    label: "Security & Incidents",
    shortLabel: "Security",
    description: "Reported security incidents, operations, crime and public-safety developments.",
    color: "#FF5C6C",
    icon: "shield",
  },
  {
    id: "politics",
    label: "Politics & Governance",
    shortLabel: "Politics",
    description: "Legislatures, elections, policy, public administration and governance.",
    color: "#A78BFA",
    icon: "landmark",
  },
  {
    id: "economy",
    label: "Economy & Business",
    shortLabel: "Economy",
    description: "Markets, investment, trade, business activity and household economic conditions.",
    color: "#2DD4BF",
    icon: "trending-up",
  },
  {
    id: "infrastructure",
    label: "Infrastructure & Transport",
    shortLabel: "Infrastructure",
    description: "Roads, power, water, rail, ports, aviation and transport projects.",
    color: "#38BDF8",
    icon: "construction",
  },
  {
    id: "environment",
    label: "Weather & Environment",
    shortLabel: "Environment",
    description: "Flooding, climate hazards, environmental change and disaster preparedness.",
    color: "#F5B942",
    icon: "cloud-rain",
  },
  {
    id: "health",
    label: "Health & Social",
    shortLabel: "Health",
    description: "Public health, outbreaks, health services and social development.",
    color: "#F472B6",
    icon: "heart-pulse",
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryConfig(category: Category): CategoryConfig {
  const config = CATEGORY_BY_ID.get(category);
  if (!config) throw new Error(`Unknown category: ${category}`);
  return config;
}

export interface ZoneConfig {
  id: ZoneId;
  name: string;
  shortName: string;
  color: string;
  description: string;
}

export const ZONES: readonly ZoneConfig[] = [
  {
    id: "north-central",
    name: "North Central",
    shortName: "NC",
    color: "#38BDF8",
    description: "Benue, Kogi, Kwara, Nasarawa, Niger, Plateau and the Federal Capital Territory.",
  },
  {
    id: "north-east",
    name: "North East",
    shortName: "NE",
    color: "#FB7185",
    description: "Adamawa, Bauchi, Borno, Gombe, Taraba and Yobe.",
  },
  {
    id: "north-west",
    name: "North West",
    shortName: "NW",
    color: "#FBBF24",
    description: "Jigawa, Kaduna, Kano, Katsina, Kebbi, Sokoto and Zamfara.",
  },
  {
    id: "south-east",
    name: "South East",
    shortName: "SE",
    color: "#A78BFA",
    description: "Abia, Anambra, Ebonyi, Enugu and Imo.",
  },
  {
    id: "south-south",
    name: "South South",
    shortName: "SS",
    color: "#34D399",
    description: "Akwa Ibom, Bayelsa, Cross River, Delta, Edo and Rivers.",
  },
  {
    id: "south-west",
    name: "South West",
    shortName: "SW",
    color: "#F472B6",
    description: "Ekiti, Lagos, Ogun, Ondo, Osun and Oyo.",
  },
];

export const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export function zoneConfig(zone: ZoneId): ZoneConfig {
  const config = ZONE_BY_ID.get(zone);
  if (!config) throw new Error(`Unknown zone: ${zone}`);
  return config;
}

export const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; shortLabel: string; color: string; description: string }
> = {
  1: {
    label: "Informational",
    shortLabel: "Info",
    color: "#64748B",
    description: "Routine or contextual information with no reported direct impact.",
  },
  2: {
    label: "Low",
    shortLabel: "Low",
    color: "#35BDF2",
    description: "Limited reported impact, often local or procedural.",
  },
  3: {
    label: "Moderate",
    shortLabel: "Mod",
    color: "#FFB020",
    description: "Notable reported disruption or impact requiring attention.",
  },
  4: {
    label: "High",
    shortLabel: "High",
    color: "#FB923C",
    description: "Serious reported impact, potentially affecting many people or services.",
  },
  5: {
    label: "Critical",
    shortLabel: "Crit",
    color: "#FF4757",
    description: "Severe reported impact. Requires verification; never inferred from a headline alone.",
  },
};

export const VERIFICATION_CONFIG: Record<
  VerificationStatus,
  { label: string; shortLabel: string; color: string; description: string }
> = {
  unassessed: {
    label: "Unassessed",
    shortLabel: "Unassessed",
    color: "#64748B",
    description: "No verification assessment has been completed.",
  },
  single_source: {
    label: "Single source",
    shortLabel: "Single",
    color: "#8492A8",
    description: "One independent source group. Not independently corroborated.",
  },
  multiple_sources: {
    label: "Multiple sources",
    shortLabel: "Multiple",
    color: "#35BDF2",
    description: "Two or more independent source groups, without full corroboration.",
  },
  corroborated: {
    label: "Corroborated",
    shortLabel: "Corroborated",
    color: "#20C997",
    description: "Independent reports agree on the core facts after review.",
  },
  official_confirmation: {
    label: "Official confirmation",
    shortLabel: "Official",
    color: "#7DD3FC",
    description: "An official institution has confirmed the event.",
  },
  disputed: {
    label: "Disputed",
    shortLabel: "Disputed",
    color: "#FFB020",
    description: "Credible reports conflict on material facts.",
  },
  retracted: {
    label: "Retracted",
    shortLabel: "Retracted",
    color: "#FF4757",
    description: "A primary source has retracted its report. Retained for the audit trail.",
  },
};

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  official: "Official",
  major_publisher: "Major publisher",
  regional_publisher: "Regional publisher",
  aggregator: "Aggregator",
  unknown: "Unknown",
};

export function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const value = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${normalized}${value}`;
}
