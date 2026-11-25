import {
  CloudRain,
  Construction,
  HeartPulse,
  Landmark,
  Shield,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES } from "@/lib/config";
import type { Category } from "@/lib/types";

/** Category palette, reused by map legends. */
export const ALL_CATEGORIES = CATEGORIES;

const ICONS: Record<Category, LucideIcon> = {
  security: Shield,
  politics: Landmark,
  economy: TrendingUp,
  infrastructure: Construction,
  environment: CloudRain,
  health: HeartPulse,
};

export function CategoryIcon({
  category,
  className,
  strokeWidth = 1.75,
}: {
  category: Category;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = ICONS[category];
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}
