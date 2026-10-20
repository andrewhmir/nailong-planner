"use client";

import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "border border-[#2468a2] bg-accent text-white hover:bg-accent-hover active:bg-accent-press",
  outline: "border border-line-strong bg-well text-ink hover:bg-line",
  ghost: "border border-transparent text-ink hover:bg-well",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2 text-sm",
  md: "h-[38px] px-3 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ className, variant = "outline", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-normal transition-colors duration-200 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
