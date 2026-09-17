import type { ReactNode } from "react";
import { cn, ITEM_META, RESULT_META, type Tone } from "@/lib/format";
import type { ItemStatus, ResultStatus } from "@/lib/types";
import Icon, { type IconName } from "./Icon";

const TONES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok ring-ok-line",
  warn: "bg-warn-soft text-warn ring-warn-line",
  bad: "bg-bad-soft text-bad ring-bad-line",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  gold: "bg-gold-100 text-gold-700 ring-gold-200",
  neutral: "bg-subtle text-ink-muted ring-line",
};

const DOTS: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  brand: "bg-brand-500",
  gold: "bg-gold-500",
  neutral: "bg-ink-faint",
};

export function Badge({
  tone = "neutral",
  icon,
  dot,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: IconName;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ring-1 ring-inset transition-colors duration-300",
        TONES[tone],
        className
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />}
      {icon && <Icon name={icon} size={11} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

const RESULT_ICON: Record<ResultStatus, IconName> = {
  pass: "check",
  alert: "alert",
  fail: "x",
  not_checked: "info",
};

export function ResultBadge({ status, overridden, className }: { status: ResultStatus; overridden?: boolean; className?: string }) {
  if (overridden) {
    return (
      <Badge tone="brand" icon="pen" className={className} title="Accepted by the assessor with justification">
        Overridden
      </Badge>
    );
  }
  const meta = RESULT_META[status] ?? RESULT_META.not_checked;
  return (
    <Badge tone={meta.tone} icon={RESULT_ICON[status]} className={className}>
      {meta.label}
    </Badge>
  );
}

export function ItemBadge({ status, awaitingPhoto }: { status: ItemStatus; awaitingPhoto?: boolean }) {
  if (status === "pending" && awaitingPhoto) {
    return (
      <Badge tone="neutral" dot title="No collateral photo uploaded yet">
        Awaiting photo
      </Badge>
    );
  }
  const meta = ITEM_META[status];
  return (
    <Badge tone={meta.tone} dot title={meta.hint}>
      {meta.label}
    </Badge>
  );
}
