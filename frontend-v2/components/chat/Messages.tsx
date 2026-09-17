"use client";

import { motion } from "framer-motion";
import { memo, useMemo } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Icon from "@/components/ui/Icon";
import { cn, formatTime } from "@/lib/format";
import { ease } from "@/lib/motion";
import { renderRich } from "@/lib/richText";
import type { ChatItem } from "@/lib/store";

export function AgentAvatar({ size = 30 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-gold-400 ring-offset-2 ring-offset-surface"
      style={{ width: size, height: size }}
    >
      <Icon name="sparkles" size={size * 0.5} />
    </span>
  );
}

export const BotMessage = memo(function BotMessage({ item, showAvatar }: { item: Extract<ChatItem, { kind: "bot" }>; showAvatar: boolean }) {
  const { start, state } = useVerification();
  const content = useMemo(() => renderRich(item.html, item.animate), [item.animate, item.html]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="flex max-w-[94%] items-end gap-2 self-start">
      <span className={cn(!showAvatar && "invisible")}>
        <AgentAvatar size={26} />
      </span>
      <div className="min-w-0">
        <div className="rounded-2xl rounded-bl-md border border-line bg-subtle px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">{content}</div>
        {item.samples && item.samples.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.samples.map((s) => (
              <button
                key={s.account_number}
                disabled={!!state.busy || !!state.session}
                onClick={() => start(s.account_number)}
                className="group flex items-center gap-1.5 rounded-full border border-brand-200 bg-surface px-2.5 py-1 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
              >
                <span className="font-mono">{s.account_number}</span>
                <span className="font-normal text-ink-muted">· {s.customer_name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 pl-1 text-2xs text-ink-faint">{formatTime(item.at)}</div>
      </div>
    </motion.div>
  );
});

export const UserMessage = memo(function UserMessage({ item }: { item: Extract<ChatItem, { kind: "user" }> }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease }}
      className="flex max-w-[86%] flex-col items-end self-end"
    >
      <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white shadow-xs">{item.text}</div>
      <div className="mt-1 pr-1 text-2xs text-ink-faint">{formatTime(item.at)}</div>
    </motion.div>
  );
});

export const NoticeMessage = memo(function NoticeMessage({ item }: { item: Extract<ChatItem, { kind: "notice" }> }) {
  const tone = {
    info: "border-brand-200 bg-brand-50 text-brand-700",
    warn: "border-warn-line bg-warn-soft text-warn",
    error: "border-bad-line bg-bad-soft text-bad",
  }[item.level];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn("flex items-start gap-2 self-stretch rounded-xl border px-3 py-2 text-xs", tone)}
      role={item.level === "error" ? "alert" : "status"}
    >
      <Icon name={item.level === "info" ? "info" : item.level === "warn" ? "lock" : "xCircle"} size={14} className="mt-px shrink-0" />
      <span>{item.text}</span>
    </motion.div>
  );
});

export function TypingIndicator() {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-end gap-2 self-start">
      <AgentAvatar size={26} />
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-line bg-subtle px-3.5 py-3" aria-label="Agent is typing">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-brand-500" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </div>
    </motion.div>
  );
}
