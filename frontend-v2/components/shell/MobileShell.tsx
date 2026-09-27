"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import ActionBar from "@/components/chat/ActionBar";
import ChatPanel from "@/components/chat/ChatPanel";
import { useAuth } from "@/components/providers/AuthProvider";
import { useVerification } from "@/components/providers/VerificationProvider";
import Icon, { type IconName } from "@/components/ui/Icon";
import VerifyView from "@/components/verify/VerifyView";
import HistoryView from "@/components/views/HistoryView";
import ReportsView from "@/components/views/ReportsView";
import SettingsView from "@/components/views/SettingsView";
import { cn } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import type { NavView } from "@/lib/store";
import { FederalMonogram } from "./Brand";
import ShellkodeLogo from "./ShellkodeLogo";

const MORE: { view: NavView; icon: IconName; label: string; hint: string }[] = [
  { view: "reports", icon: "chart", label: "Reports", hint: "Outcomes by date and loan account" },
  { view: "history", icon: "history", label: "History", hint: "Reopen a past verification" },
  { view: "settings", icon: "gear", label: "Settings", hint: "AI, thresholds and pledge valuation" },
];

/**
 * The phone and tablet shell: one column, the dashboard and the agent as tabs, and the step's
 * primary action pinned above the tab bar so the next thing to do is always under your thumb.
 */
export default function MobileShell() {
  const { state, session, setView, openDialog } = useVerification();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<"verify" | "agent">("verify");
  const [more, setMore] = useState(false);
  const [unread, setUnread] = useState(0);

  const onVerify = state.view === "verify";
  const reference = session?.loan.account_number || session?.application.reference || "";
  const seen = useRef(state.messages.length);

  // Count what the agent says while the assessor is looking at the dashboard.
  useEffect(() => {
    if (tab === "agent" && onVerify) {
      seen.current = state.messages.length;
      setUnread(0);
      return;
    }
    const fresh = state.messages.slice(seen.current).filter((m) => m.kind !== "user").length;
    if (fresh) setUnread((n) => n + fresh);
    seen.current = state.messages.length;
  }, [state.messages, tab, onVerify]);

  // A step that opens a dialog (or finishes) is easier to follow on the dashboard.
  useEffect(() => {
    if (state.dialog) setTab("verify");
  }, [state.dialog]);

  const openMore = (view: NavView) => {
    setMore(false);
    setView(view);
  };

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-canvas">
      {/* ---------------------------------------------------------------- header */}
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-label="Menu"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-2 active:bg-brand-50"
        >
          <Icon name="layers" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight text-ink">
            {onVerify ? session?.loan.customer_name || "GL Portal" : MORE.find((m) => m.view === state.view)?.label}
          </p>
          <p className={cn("truncate text-2xs text-ink-muted", reference && "font-mono")}>
            {onVerify ? reference || "Gold loan collateral verification" : "Federal Bank"}
          </p>
        </div>
        {session && onVerify && (
          <button
            type="button"
            disabled={!!state.busy}
            onClick={() => openDialog({ kind: "new-session" })}
            aria-label="Start a new verification"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-2 active:bg-brand-50 disabled:text-ink-faint"
          >
            <Icon name="plus" size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-label={user ? `${user.name}, account menu` : "Account"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-brand-900"
        >
          {user?.initials || "··"}
        </button>
      </header>

      {/* ---------------------------------------------------------------- body */}
      <main className="relative min-h-0 flex-1">
        {onVerify ? (
          <>
            <div className={cn("absolute inset-0", tab === "verify" ? "block" : "hidden")}>
              <VerifyView />
            </div>
            <div className={cn("absolute inset-0", tab === "agent" ? "block" : "hidden")}>
              <ChatPanel showActions={false} />
            </div>
          </>
        ) : (
          <div className="absolute inset-0">
            {state.view === "reports" && <ReportsView />}
            {state.view === "history" && <HistoryView />}
            {state.view === "settings" && <SettingsView />}
          </div>
        )}
      </main>

      {/* ------------------------------------------------- pinned action + tabs */}
      {onVerify && session && tab === "verify" && <ActionBar />}
      {onVerify && (
        <nav className="z-20 flex shrink-0 border-t border-line bg-surface pb-safe" aria-label="Sections">
          {([
            { key: "verify", icon: "shieldCheck", label: "Verify" },
            { key: "agent", icon: "sparkles", label: "Agent" },
          ] as const).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors",
                  active ? "text-brand-700" : "text-ink-faint"
                )}
              >
                {active && (
                  <motion.span layoutId="tab-active" transition={spring} className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-brand-600" />
                )}
                <span className="relative">
                  <Icon name={t.icon} size={20} />
                  {t.key === "agent" && unread > 0 && (
                    <span className="absolute -right-1.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[9px] font-bold text-brand-900">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </span>
                {t.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* ---------------------------------------------------------------- menu */}
      <AnimatePresence>
        {more && (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMore(false)}
              className="fixed inset-0 z-40 bg-brand-950/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease }}
              className="fixed inset-y-0 left-0 z-50 flex w-[290px] max-w-[85vw] flex-col bg-surface shadow-lift"
            >
              <div className="flex items-center gap-3 border-b border-line px-4 py-4">
                <FederalMonogram />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">GL Portal</p>
                  <p className="truncate text-2xs text-ink-muted">Gold Loan Collateral Verification</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                <button
                  type="button"
                  onClick={() => openMore("verify")}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    state.view === "verify" ? "bg-brand-50 text-brand-700" : "text-ink-2 active:bg-subtle"
                  )}
                >
                  <Icon name="shieldCheck" size={18} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">Verify</span>
                    <span className="block text-2xs text-ink-muted">The collateral verification journey</span>
                  </span>
                </button>
                {MORE.map((item) => (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => openMore(item.view)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      state.view === item.view ? "bg-brand-50 text-brand-700" : "text-ink-2 active:bg-subtle"
                    )}
                  >
                    <Icon name={item.icon} size={18} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className="block text-2xs text-ink-muted">{item.hint}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="border-t border-line p-3 pb-safe">
                <p className="px-3 text-sm font-semibold text-ink">{user?.name}</p>
                <p className="px-3 text-xs text-ink-muted">{user?.role}</p>
                <p className="mt-1.5 ml-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 font-mono text-2xs font-semibold text-brand-700">
                  <Icon name="bank" size={11} /> {user?.branch || "—"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMore(false);
                    void signOut();
                  }}
                  className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-2 transition-colors active:bg-bad-soft active:text-bad"
                >
                  <Icon name="logout" size={17} /> Sign out
                </button>
                <div className="mt-2 flex items-center justify-center gap-1.5 pt-1 text-[10px] uppercase tracking-wider text-ink-faint">
                  Powered by <ShellkodeLogo className="h-3 w-auto text-ink-muted" />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}