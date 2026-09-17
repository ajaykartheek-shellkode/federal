"use client";

import { motion } from "framer-motion";
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
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-brand-900 ring-2 ring-white/20"
        title="Branch assessor"
      >
        BA
      </div>
    </nav>
  );
}
