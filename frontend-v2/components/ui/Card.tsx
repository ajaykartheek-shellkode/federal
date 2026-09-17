"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import Icon, { type IconName } from "./Icon";

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <motion.section
      id={id}
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className={cn("rounded-2xl border border-line bg-surface shadow-card", className)}
    >
      {children}
    </motion.section>
  );
}

export function CardHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-5 pb-3 pt-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon name={icon} size={17} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, hint, className }: { icon: IconName; title: string; hint?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-8 text-center", className)}>
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-400">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
