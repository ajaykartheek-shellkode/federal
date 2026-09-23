"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { formatDateTime } from "@/lib/format";
import type { AuditTarget, SessionView } from "@/lib/types";

const TARGET: Record<AuditTarget, { label: string; tone: "brand" | "gold" | "neutral" }> = {
  item: { label: "Item confirmed", tone: "brand" },
  damage: { label: "Damage accepted", tone: "gold" },
  document: { label: "Document accepted", tone: "gold" },
  edit: { label: "Correction", tone: "neutral" },
  measurement: { label: "Reading accepted", tone: "gold" },
  scale: { label: "Machine total", tone: "neutral" },
  weight: { label: "Weight recorded", tone: "neutral" },
};

export default function AuditTrail({ session }: { session: SessionView }) {
  if (!session.audit.length) return null;
  return (
    <Card id="card-audit">
      <CardHeader icon="lock" title="Audit trail" subtitle="Overrides and corrections are immutable and included in the report" />
      <ol className="relative space-y-3 px-5 pb-5">
        {[...session.audit].reverse().map((a, i) => (
          <motion.li key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-3">
            <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Icon
                name={
                  a.target === "edit" ? "pen" : a.target === "scale" || a.target === "weight" ? "weighScale" : "shieldCheck"
                }
                size={14}
              />
            </span>
            <div className="min-w-0 flex-1 rounded-xl border border-line bg-subtle px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {a.item}{" "}
                  <Badge tone={TARGET[a.target]?.tone ?? "neutral"}>
                    {a.new_value === "accepted by assessor" && a.target === "scale"
                      ? "Difference accepted"
                      : a.new_value === "added by assessor"
                        ? "Ornament added"
                        : a.new_value === "removed by assessor"
                          ? "Ornament removed"
                          : (TARGET[a.target]?.label ?? "Change")}
                  </Badge>
                </span>
                <span className="text-2xs text-ink-faint">{formatDateTime(a.ts)}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">
                {a.original} <Icon name="arrowRight" size={11} className="inline" /> {a.new_value}
              </p>
              <p className="mt-1 text-sm text-ink-2">“{a.justification}”</p>
            </div>
          </motion.li>
        ))}
      </ol>
    </Card>
  );
}
