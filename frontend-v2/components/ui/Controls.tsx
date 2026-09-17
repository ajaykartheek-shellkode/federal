"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { spring } from "@/lib/motion";

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 disabled:opacity-50",
        checked ? "justify-end bg-brand-600" : "justify-start bg-line-strong"
      )}
    >
      <motion.span layout transition={spring} className="h-5 w-5 rounded-full bg-white shadow-xs" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  layoutId: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="inline-flex rounded-xl border border-line bg-subtle p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-lg font-semibold transition-colors",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
              active ? "text-brand-700" : "text-ink-muted hover:text-ink"
            )}
          >
            {active && (
              <motion.span layoutId={layoutId} transition={spring} className="absolute inset-0 rounded-lg bg-surface shadow-xs ring-1 ring-line" />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Counts smoothly to a new value. */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (n) => format(n));
  const [display, setDisplay] = useState(() => format(value));

  useEffect(() => text.on("change", setDisplay), [text]);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value]);

  return <span className="tabular-nums">{display}</span>;
}

/** Linear progress / proportion bar. */
export function ProgressBar({ value, tone = "brand", className }: { value: number; tone?: "brand" | "ok" | "warn" | "bad" | "gold"; className?: string }) {
  const color = { brand: "bg-brand-500", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", gold: "bg-gold-500" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
