"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useVerification } from "@/components/providers/VerificationProvider";
import { reportPdfUrl } from "@/lib/api";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { ease } from "@/lib/motion";
import ReportDocument from "./ReportDocument";
import ScaledPage from "./ScaledPage";

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
          <div className="no-print flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-2.5 shadow-card desk:px-6 desk:py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Icon name="doc" size={18} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">Verification report</p>
                <p className="truncate font-mono text-2xs text-ink-muted">{session.report.report_id}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/report/${session.session_id}`}
                target="_blank"
                rel="noreferrer"
                className="hidden h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink-2 transition-colors hover:bg-brand-50 hover:text-brand-700 desk:inline-flex"
              >
                <Icon name="external" size={16} /> Open in new tab
              </a>
              <span className="hidden desk:inline-flex">
                <Button variant="secondary" icon="printer" onClick={() => window.print()}>
                  Print
                </Button>
              </span>
              <a
                href={reportPdfUrl(session.session_id)}
                download={`${session.report.report_id}.pdf`}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-gold-500 px-3.5 text-sm font-semibold text-brand-900 shadow-gold transition-colors hover:bg-gold-400 desk:px-4"
              >
                <Icon name="download" size={16} /> <span className="hidden sm:inline">Download </span>PDF
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close the report"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-brand-50 desk:hidden"
              >
                <Icon name="x" size={18} />
              </button>
              <span className="hidden desk:inline-flex">
                <Button variant="secondary" icon="x" onClick={onClose}>
                  Close
                </Button>
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 desk:px-6 desk:py-8">
            <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { duration: 0.45, ease } }} exit={{ y: 12, opacity: 0 }}>
              <ScaledPage>
                <ReportDocument session={session} />
              </ScaledPage>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
