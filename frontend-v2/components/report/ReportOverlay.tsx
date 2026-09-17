"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { ease } from "@/lib/motion";
import ReportDocument from "./ReportDocument";

/** Full-screen report viewer. Rendered as a direct child of <body> so print shows only the report. */
export default function ReportOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useVerification();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !session?.report) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          id="report-print-root"
          className="fixed inset-0 z-[240] flex flex-col bg-brand-950/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Verification report"
        >
          <div className="no-print flex shrink-0 items-center justify-between border-b border-line bg-surface px-6 py-3 shadow-card">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Icon name="doc" size={18} />
              </span>
              <div>
                <p className="text-sm font-bold text-ink">Verification report</p>
                <p className="font-mono text-2xs text-ink-muted">{session.report.report_id}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/report/${session.session_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink-2 transition-colors hover:bg-brand-50 hover:text-brand-700"
              >
                <Icon name="external" size={16} /> Open in new tab
              </a>
              <Button variant="gold" icon="download" onClick={() => window.print()}>
                Download PDF
              </Button>
              <Button variant="secondary" icon="x" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { duration: 0.45, ease } }} exit={{ y: 12, opacity: 0 }}>
              <ReportDocument session={session} />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
