"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { cn, WORKFLOW_STEPS } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { SessionView } from "@/lib/types";

export default function ProgressStepper({ session }: { session: SessionView }) {
  // Sessions created before the Weight & purity step run four steps.
  const keys: string[] = session.steps ?? WORKFLOW_STEPS.map((w) => w.key);
  const steps = WORKFLOW_STEPS.filter((s) => keys.includes(s.key));
  const current = session.workflow_state === "done" ? steps.length : steps.findIndex((s) => s.key === session.workflow_state);
  const fill = Math.min(1, current / (steps.length - 1));

  return (
    <div className="flex items-center gap-6 rounded-2xl border border-line bg-surface/90 px-6 py-3.5 shadow-card backdrop-blur">
      <ol className="relative flex flex-1 items-start justify-between">
        <div className="absolute left-[16px] right-[16px] top-[15px] h-[3px] rounded-full bg-line" aria-hidden>
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-ok via-ok to-gold-500"
            initial={false}
            animate={{ width: `${fill * 100}%` }}
            transition={{ duration: 0.7, ease }}
          />
        </div>
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step.key} className="relative z-10 flex flex-col items-center gap-1.5" aria-current={active ? "step" : undefined}>
              <motion.span
                initial={false}
                animate={{ scale: active ? 1.08 : 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
                className={cn(
                  "flex h-[33px] w-[33px] items-center justify-center rounded-full text-sm font-bold transition-colors duration-300",
                  done && "bg-ok text-white",
                  active && "animate-pulse-ring bg-gold-500 text-brand-900",
                  !done && !active && "border-2 border-line-strong bg-surface text-ink-faint"
                )}
              >
                {done ? <Icon name="check" size={16} strokeWidth={3} /> : i + 1}
              </motion.span>
              <span className={cn("whitespace-nowrap text-xs", active ? "font-bold text-ink" : done ? "font-semibold text-ink-2" : "text-ink-muted")}>
                {/* Six steps don't fit at full width — fall back to the short names. */}
                {steps.length > 5 ? step.short : step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex shrink-0 flex-col items-end gap-1.5 border-l border-line pl-5">
        <Badge tone={session.settings.blocker_mode ? "bad" : "brand"} icon={session.settings.blocker_mode ? "lock" : "info"}>
          {session.settings.blocker_mode ? "Blocker mode" : "Alert mode"}
        </Badge>
        <Badge tone={session.ai_enabled ? "ok" : "neutral"} icon={session.ai_enabled ? "sparkles" : "x"}>
          {session.ai_enabled ? "AI validation on" : "AI validation off"}
        </Badge>
      </div>
    </div>
  );
}
