"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { cn, formatINR } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { LoanCategory, LoanType, SessionView } from "@/lib/types";

const TYPES: LoanType[] = ["ODA", "LAA", "CCA"];
const CATEGORIES: LoanCategory[] = ["GGL", "KGL", "IGL"];

function Choice({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-baseline gap-2 text-2xs font-bold uppercase tracking-wider text-ink-muted">
        {label}
        {hint && <span className="font-sans text-2xs font-normal normal-case tracking-normal text-ink-faint">{hint}</span>}
      </p>
      {children}
    </div>
  );
}

/**
 * Loan type → category → scheme, captured before the loan amount can be computed. The scheme's
 * per-gram rate is what prices the net weight, so nothing is shown as an amount until one is
 * chosen — and some type/category pairs have no scheme configured at all.
 */
export default function SchemePicker({ session }: { session: SessionView }) {
  const { chooseScheme, state } = useVerification();
  const chosen = session.loan_scheme;
  const locked = session.workflow_state === "done" || !!session.report?.submitted_at;

  const [loanType, setLoanType] = useState<LoanType | "">(chosen?.loan_type ?? "");
  const [loanCategory, setLoanCategory] = useState<LoanCategory | "">(chosen?.loan_category ?? "");

  const schemes = session.options.schemes;
  const catalogue = useMemo(() => schemes ?? [], [schemes]);
  const available = useMemo(
    () => catalogue.filter((s) => s.loan_type === loanType && s.loan_category === loanCategory),
    [catalogue, loanType, loanCategory]
  );
  // Which categories this loan type actually has schemes for — the rest are dead ends.
  const configured = useMemo(
    () => new Set(catalogue.filter((s) => s.loan_type === loanType).map((s) => s.loan_category)),
    [catalogue, loanType]
  );

  const busy = !!state.busy;
  const picked = (name: string) => chosen?.name === name && chosen.loan_type === loanType && chosen.loan_category === loanCategory;

  return (
    <div className="rounded-2xl border border-line bg-subtle/60 px-4 py-3.5 desk:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon name="rupee" size={15} className="text-brand-600" /> Loan scheme
        </p>
        {chosen ? (
          <Badge tone="ok" icon="check">
            {chosen.name} · {chosen.tenure_months} months · {formatINR(chosen.rate_per_gram)}/g
          </Badge>
        ) : (
          <Badge tone="warn" dot>
            Choose one to price the loan
          </Badge>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Choice label="Loan type">
          <div className="grid grid-cols-3 gap-1.5">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                disabled={locked || busy}
                onClick={() => {
                  setLoanType(t);
                  setLoanCategory("");
                }}
                className={cn(
                  "h-10 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-50",
                  loanType === t ? "border-brand-500 bg-brand-50 text-brand-700 shadow-focus" : "border-line-strong text-ink-2 hover:border-brand-300"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </Choice>

        <Choice label="Loan category" hint={loanType ? undefined : "pick a loan type first"}>
          <div className="grid grid-cols-3 gap-1.5">
            {CATEGORIES.map((c) => {
              const has = configured.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  disabled={locked || busy || !loanType}
                  title={loanType && !has ? `No scheme is configured for ${loanType} · ${c}` : undefined}
                  onClick={() => setLoanCategory(c)}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-50",
                    loanCategory === c
                      ? "border-brand-500 bg-brand-50 text-brand-700 shadow-focus"
                      : loanType && !has
                        ? "border-dashed border-line text-ink-faint"
                        : "border-line-strong text-ink-2 hover:border-brand-300"
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </Choice>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {loanType && loanCategory && (
          <motion.div
            key={`${loanType}-${loanCategory}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease }}
            className="mt-3"
          >
            <Choice label="Scheme name">
              {available.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-warn">
                  <Icon name="info" size={14} className="shrink-0" />
                  No scheme is configured for {loanType} · {loanCategory}.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {available.map((s) => (
                    <Button
                      key={s.name}
                      variant={picked(s.name) ? "primary" : "secondary"}
                      icon={picked(s.name) ? "check" : undefined}
                      disabled={locked || busy}
                      onClick={() => void chooseScheme(loanType, loanCategory, s.name)}
                    >
                      <span className="flex flex-col items-start leading-tight">
                        <span>{s.name}</span>
                        <span className={cn("text-2xs font-normal", picked(s.name) ? "text-white/70" : "text-ink-muted")}>
                          {s.tenure_months} months · {formatINR(s.rate_per_gram)}/g
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </Choice>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
