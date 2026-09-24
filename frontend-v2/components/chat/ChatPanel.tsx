"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/format";
import ActionBar from "./ActionBar";
import ExecCard from "./ExecCard";
import { AgentAvatar, BotMessage, NoticeMessage, TypingIndicator, UserMessage } from "./Messages";

export default function ChatPanel() {
  const { state, session, send } = useVerification();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);

  const activeRun = Object.values(state.runs).some((r) => !r.done);
  const typing = state.answering || (!!state.busy && state.busy !== "mutate" && !activeRun);
  const composerLocked = !!state.busy || state.answering;

  // Keep the newest message in view unless the assessor has scrolled up to read history.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [state.messages, state.runs, typing]);

  useEffect(() => {
    if (!state.busy && !state.answering && !state.dialog) inputRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refocus only when work finishes, not on dialog changes
  }, [state.busy, state.answering, session?.session_id]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  const submit = () => {
    const value = text.trim();
    if (!value || composerLocked) return;
    setText("");
    stickToBottom.current = true;
    void send(value);
  };

  return (
    <aside aria-label="Verification Agent" className="flex min-h-0 w-[392px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <AgentAvatar size={34} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-ink">Verification Agent</h2>
          <p className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Guides each step · Claude on Amazon Bedrock
          </p>
        </div>
        {session && !session.ai_enabled && (
          <span className="rounded-full bg-subtle px-2 py-0.5 text-2xs font-semibold text-ink-muted ring-1 ring-line" title="AI validation is off for this scenario">
            AI off
          </span>
        )}
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 [&>*]:shrink-0">
        {state.messages.map((m, i) => {
          if (m.kind === "bot") {
            const next = state.messages[i + 1];
            return <BotMessage key={m.id} item={m} showAvatar={!next || next.kind !== "bot"} />;
          }
          if (m.kind === "user") return <UserMessage key={m.id} item={m} />;
          if (m.kind === "notice") return <NoticeMessage key={m.id} item={m} />;
          const run = state.runs[m.runId];
          return run ? <ExecCard key={m.id} run={run} /> : null;
        })}
        <AnimatePresence>{typing && <TypingIndicator key="typing" />}</AnimatePresence>
      </div>

      <ActionBar />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cn("px-3 pb-3", session ? "pt-1" : "border-t border-line pt-3")}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface py-1.5 pl-4 pr-1.5 transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:shadow-focus">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            disabled={state.busy === "restore"}
            placeholder={session ? "Ask a question or type a reply…" : "CIF, mobile, ID number or loan account…"}
            aria-label={session ? "Message the Verification Agent" : "Customer CIF, mobile, ID number or loan account"}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.92 }}
            disabled={!text.trim() || composerLocked}
            aria-label="Send"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-line disabled:text-ink-faint"
          >
            <Icon name="send" size={16} />
          </motion.button>
        </div>
      </form>
    </aside>
  );
}
