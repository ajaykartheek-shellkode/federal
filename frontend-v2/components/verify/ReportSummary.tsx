"use client";

import { motion } from "framer-motion";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { cn, formatDateTime } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { SessionView } from "@/lib/types";

export default function ReportSummary({ session }: { session: SessionView }) {
  const { openDialog } = useVerification();
  const report = session.report;
  if (!report) return null;
  const proceed = report.recommendation === "PROCEED";
  const warnings = report.reasons.filter((r) => r.level === "warn");
  const infos = report.reasons.filter((r) => r.level === "info");

  return (
    <motion.section
      id="card-report"
      initial={{ opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease }}
      className={cn("overflow-hidden rounded-3xl border bg-surface shadow-raised", proceed ? "border-ok-line" : "border-gold-300")}
    >
      <div className={cn("flex flex-wrap items-center justify-between gap-4 px-6 py-5", proceed ? "bg-ok-soft" : "bg-cream")}>
        <div className="flex items-center gap-4">
          <motion.span
            initial={{ scale: 0.4, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.15 }}
            className={cn("flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-raised", proceed ? "bg-ok" : "bg-gold-500")}
          >
            <Icon name={proceed ? "shieldCheck" : "flag"} size={28} strokeWidth={2} />
          </motion.span>
          <div>
            <p className="text-2xs font-bold uppercase tracking-[0.16em] text-ink-muted">Recommendation</p>
            <p className={cn("text-3xl font-bold leading-none", proceed ? "text-ok" : "text-gold-700")}>{report.recommendation}</p>
            <p className="mt-1 text-xs text-ink-muted">
              <span className="font-mono">{report.report_id}</span> · generated {formatDateTime(report.generated_at)}
            </p>
          </div>
        </div>
        <Button variant="gold" size="lg" icon="doc" onClick={() => openDialog({ kind: "report" })}>
          Open report & e-sign
        </Button>
      </div>
      {(warnings.length > 0 || infos.length > 0) && (
        <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
          {warnings.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-warn">For the approving officer</p>
              <ul className="space-y-1">
                {warnings.map((r) => (
                  <li key={r.text} className="flex gap-2 text-sm text-ink-2">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-warn" /> {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {infos.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-600">Notes</p>
              <ul className="space-y-1">
                {infos.map((r) => (
                  <li key={r.text} className="flex gap-2 text-sm text-ink-2">
                    <Icon name="info" size={15} className="mt-0.5 shrink-0 text-brand-500" /> {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
