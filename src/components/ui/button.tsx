import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border text-[12px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-info/50 bg-info text-canvas hover:bg-info/85",
        secondary:
          "border-line-2 bg-panel-2 text-ink hover:border-line-2 hover:bg-panel-3",
        outline:
          "border-line bg-transparent text-muted hover:border-line-2 hover:bg-panel-2 hover:text-ink",
        ghost:
          "border-transparent bg-transparent text-muted hover:bg-panel-2 hover:text-ink",
        danger:
          "border-critical/50 bg-critical/15 text-critical hover:bg-critical/25",
        amber:
          "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20",
      },
      size: {
        xs: "h-6 px-2 text-[10px]",
        sm: "h-7 px-2.5 text-[11px]",
        md: "h-8 px-3",
        lg: "h-9 px-4 text-[13px]",
        icon: "h-8 w-8 p-0",
        iconSm: "h-7 w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
