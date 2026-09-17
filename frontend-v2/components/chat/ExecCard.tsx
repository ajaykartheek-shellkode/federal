"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ResultBadge } from "@/components/ui/Badge";
import Icon, { type IconName } from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import { AGENT_LABEL, cn, formatDuration } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { ExecRun } from "@/lib/store";
import type { ResultStatus } from "@/lib/types";

const AGENT_ICON: Record<string, IconName> = {
  collateral: "gem",
  weight: "scale",
  damage: "alert",
  document: "idCard",
  report: "doc",
};

/** The "Agent Executing" card: each real processing step with a live spinner, check and timing. */
export default function ExecCard({ run }: { run: ExecRun }) {
  const done = run.done;
  const completed = run.steps.filter((s) => s.status === "done").length;
  const errored = done?.status === "error" || run.steps.some((s) => s.status === "error");
  const [expanded, setExpanded] = useState(true);

  // Collapse to a one-line summary shortly after the run finishes (keeps the chat tidy).
  useEffect(() => {
    if (!done || errored) return;
    const t = window.setTimeout(() => setExpanded(false), 1600);
    return () => window.clearTimeout(t);
  }, [done, errored]);

  const progress = Math.round((completed / Math.max(1, run.total)) * 100);
  const barTone = errored ? "bg-bad" : done ? (done.status === "alert" ? "bg-warn" : done.status === "fail" ? "bg-bad" : "bg-ok") : "bg-gold-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease }}
      className="w-full shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-xs"
    >
      <div className="h-[3px] w-full bg-line/70">
        <motion.div className={cn("h-full", barTone)} animate={{ width: `${done ? 100 : progress}%` }} transition={{ duration: 0.4, ease }} />
      </div>

      <button
        type="button"
        onClick={() => done && setExpanded((v) => !v)}
        className={cn("flex w-full items-center gap-2.5 px-3 py-2.5 text-left", done && "hover:bg-subtle")}
        aria-expanded={expanded}
        disabled={!done}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon name={AGENT_ICON[run.agent] ?? "cpu"} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-ink">{AGENT_LABEL[run.agent] ?? "Agent"}</span>
          <span className="block truncate text-2xs text-ink-muted">
            {done ? done.summary : `Running · step ${Math.min(completed + 1, run.total)} of ${run.total}`}
          </span>
        </span>
        {done ? (
          <span className="flex items-center gap-1.5">
            {errored ? (
              <ResultBadge status="fail" />
            ) : done.status === "info" ? null : (
              <ResultBadge status={done.status as ResultStatus} />
            )}
            <Icon name="chevronDown" size={14} className={cn("text-ink-faint transition-transform", expanded && "rotate-180")} />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-gold-700">
            <Spinner size={13} className="text-gold-600" /> Executing
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            className="overflow-hidden border-t border-line/70 px-3 pb-2 pt-1.5"
          >
            <AnimatePresence initial={false}>
              {run.steps.map((s) => (
                <motion.li
                  key={s.index}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, ease }}
                  className="flex items-center gap-2.5 py-[3px] text-xs"
                >
                  <StepIndicator status={s.status} />
                  <span className={cn("flex-1 transition-colors", s.status === "active" ? "font-semibold text-ink" : s.status === "error" ? "text-bad" : "text-ink-2")}>
                    {s.label}
                  </span>
                  {s.elapsed_ms !== undefined && s.status !== "active" && (
                    <span className="font-mono text-2xs tabular-nums text-ink-faint">{formatDuration(s.elapsed_ms)}</span>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
            {done && (
              <div className="mt-1.5 flex items-center justify-between border-t border-dashed border-line pt-1.5 text-2xs text-ink-muted">
                <span>{completed} of {run.total} steps</span>
                <span className="font-mono tabular-nums">Total {formatDuration(done.total_ms)}</span>
              </div>
            )}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StepIndicator({ status }: { status: "active" | "done" | "error" }) {
  return (
    <span className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {status === "active" ? (
          <motion.span
            key="active"
            exit={{ scale: 0.6, opacity: 0 }}
            className="flex h-[18px] w-[18px] animate-pulse-ring items-center justify-center rounded-full bg-gold-100 text-gold-700"
          >
            <Spinner size={11} />
          </motion.span>
        ) : status === "done" ? (
          <motion.span
            key="done"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 600, damping: 22 }}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ok text-white"
          >
            <Icon name="check" size={11} strokeWidth={3} />
          </motion.span>
        ) : (
          <motion.span key="error" initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-bad text-white">
            <Icon name="x" size={11} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
