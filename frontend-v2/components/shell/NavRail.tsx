"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useVerification } from "@/components/providers/VerificationProvider";
import Icon, { type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/format";
import { spring } from "@/lib/motion";
import type { NavView } from "@/lib/store";
import { FederalMonogram } from "./Brand";

const ITEMS: { view: NavView; icon: IconName; label: string }[] = [
  { view: "verify", icon: "shieldCheck", label: "Verify" },
  { view: "reports", icon: "chart", label: "Reports" },
  { view: "history", icon: "history", label: "History" },
  { view: "settings", icon: "gear", label: "Settings" },
];

export default function NavRail() {
  const { state, setView } = useVerification();
  const { user, signOut } = useAuth();
  const [menu, setMenu] = useState(false);

  return (
    <nav aria-label="Primary" className="relative z-20 flex w-[76px] flex-col items-center bg-brand-rail py-4 text-white">
      <FederalMonogram />
      <div className="mt-7 flex w-full flex-col items-center gap-1.5 px-2">
        {ITEMS.map((it) => {
          const active = state.view === it.view;
          return (
            <button
              key={it.view}
              onClick={() => setView(it.view)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px] font-semibold tracking-wide transition-colors",
                active ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              {active && (
                <motion.span layoutId="nav-active" transition={spring} className="absolute inset-0 rounded-xl bg-white/[0.12] ring-1 ring-white/15">
                  <span className="absolute -left-2 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-gold-500" />
                </motion.span>
              )}
              <Icon name={it.icon} size={20} className="relative" />
              <span className="relative">{it.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <div className="relative w-full px-2 pb-1">
        {menu && (
          <>
            <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring}
              className="absolute bottom-full left-2 z-20 mb-2 w-60 origin-bottom-left rounded-2xl border border-line bg-surface p-3 text-left shadow-lift"
            >
              <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
              <p className="truncate text-xs text-ink-muted">{user?.role}</p>
              <p className="mt-0.5 truncate font-mono text-2xs text-ink-faint">{user?.email}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 font-mono text-2xs font-semibold text-brand-700">
                <Icon name="bank" size={11} /> {user?.branch || "—"}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  void signOut();
                }}
                className="mt-3 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-ink-2 transition-colors hover:bg-bad-soft hover:text-bad"
              >
                <Icon name="logout" size={16} /> Sign out
              </button>
            </motion.div>
          </>
        )}
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menu}
          title={user ? `${user.name} · ${user.role}` : "Account"}
          className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-brand-900 ring-2 ring-white/20 transition-transform hover:scale-105"
        >
          {user?.initials || "··"}
        </button>
      </div>
    </nav>
  );
}
