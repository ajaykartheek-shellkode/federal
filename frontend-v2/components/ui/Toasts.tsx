"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { cn } from "@/lib/format";
import type { Toast } from "@/lib/store";
import Icon, { type IconName } from "./Icon";

const STYLE: Record<Toast["tone"], { icon: IconName; accent: string }> = {
  ok: { icon: "checkCircle", accent: "text-ok" },
  warn: { icon: "alert", accent: "text-warn" },
  bad: { icon: "xCircle", accent: "text-bad" },
  info: { icon: "info", accent: "text-brand-600" },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = window.setTimeout(() => dismissRef.current(), toast.tone === "bad" ? 7000 : 4500);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.tone]);

  const style = STYLE[toast.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      role="status"
      className="pointer-events-auto flex w-[340px] items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-raised"
    >
      <Icon name={style.icon} size={18} className={cn("mt-0.5 shrink-0", style.accent)} />
      <p className="flex-1 text-sm text-ink">{toast.text}</p>
      <button onClick={onDismiss} aria-label="Dismiss" className="-mr-1 rounded-md p-0.5 text-ink-faint hover:text-ink">
        <Icon name="x" size={14} />
      </button>
    </motion.div>
  );
}

export default function Toasts() {
  const { state, dismissToast } = useVerification();
  return (
    <div className="pointer-events-none fixed left-[calc(50%-158px)] top-[80px] z-[300] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {state.toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
