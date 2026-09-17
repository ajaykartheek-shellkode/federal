"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/format";
import Icon, { type IconName } from "./Icon";
import Spinner from "./Spinner";

type Variant = "primary" | "gold" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300",
  gold: "bg-gold-500 text-brand-900 shadow-gold hover:bg-gold-400 active:bg-gold-600 disabled:bg-gold-200 disabled:shadow-none",
  secondary:
    "bg-surface text-brand-700 border border-line-strong hover:border-brand-300 hover:bg-brand-50 disabled:text-ink-faint disabled:bg-subtle",
  ghost: "text-ink-2 hover:bg-brand-50 hover:text-brand-700 disabled:text-ink-faint",
  danger: "bg-bad text-white hover:brightness-95 disabled:opacity-50",
  link: "text-brand-600 underline-offset-4 hover:underline px-0 disabled:text-ink-faint",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, iconRight, loading, disabled, className, children, type = "button", ...rest },
  ref
) {
  const isDisabled = disabled || loading;
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors duration-150 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
    </motion.button>
  );
});

export default Button;
