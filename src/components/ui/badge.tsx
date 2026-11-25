import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase leading-none tracking-[0.08em]",
  {
    variants: {
      variant: {
        default: "border-line-2 bg-panel-2 text-muted",
        outline: "border-line bg-transparent text-muted",
        info: "border-info/30 bg-info/10 text-info",
        critical: "border-critical/35 bg-critical/10 text-critical",
        warning: "border-warning/35 bg-warning/10 text-warning",
        positive: "border-positive/30 bg-positive/10 text-positive",
        demo: "border-warning/40 bg-warning/10 text-warning",
        muted: "border-transparent bg-panel-3 text-faint",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
