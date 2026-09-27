"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import ChatPanel from "@/components/chat/ChatPanel";
import DialogHost from "@/components/dialogs/DialogHost";
import { useVerification, VerificationProvider } from "@/components/providers/VerificationProvider";
import Toasts from "@/components/ui/Toasts";
import VerifyView from "@/components/verify/VerifyView";
import HistoryView from "@/components/views/HistoryView";
import ReportsView from "@/components/views/ReportsView";
import SettingsView from "@/components/views/SettingsView";
import { viewTransition } from "@/lib/motion";
import { useIsDesktop } from "@/lib/useMediaQuery";
import MobileShell from "./MobileShell";
import NavRail from "./NavRail";
import TopBar from "./TopBar";

function Main() {
  const { state } = useVerification();
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <TopBar />
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          <motion.div key={state.view} {...viewTransition} className="absolute inset-0 bg-canvas">
            {state.view === "verify" && <VerifyView />}
            {state.view === "reports" && <ReportsView />}
            {state.view === "history" && <HistoryView />}
            {state.view === "settings" && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}

/** Three columns on the desktop; one column with bottom tabs on a phone or tablet. */
function Shell() {
  const desktop = useIsDesktop();
  if (!desktop) return <MobileShell />;
  return (
    <div className="flex h-screen max-h-screen overflow-hidden">
      <NavRail />
      <Main />
      <ChatPanel />
    </div>
  );
}

export default function AppShell() {
  return (
    <MotionConfig reducedMotion="user">
      <VerificationProvider>
        <Shell />
        <DialogHost />
        <Toasts />
      </VerificationProvider>
    </MotionConfig>
  );
}
