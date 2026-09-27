"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { AnimatedNumber } from "@/components/ui/Controls";
import Icon from "@/components/ui/Icon";
import { formatINR, formatNumber, formatWeight, plural } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { SessionView } from "@/lib/types";

/** The loan follows the weight: gross → less wastage → net → × the rate per gram. */
export default function PledgeCard({ session }: { session: SessionView }) {
  const { valuation } = session;
  const t = valuation.totals;
  const netShare = t.gross_weight_g > 0 ? t.net_weight_g / t.gross_weight_g : 0;

  return (
    <Card id="card-pledge">
      <CardHeader
        icon="rupee"
        title="Loan valuation"
        subtitle={`Net weight at ${formatINR(t.rate_per_gram)} per gram · wastage ${formatNumber(t.wastage_pct)}%`}
        actions={
          t.is_estimate ? (
            <Badge tone="gold" icon="info" title="Provisional until every ornament has a Karatometer assay">
              Provisional
            </Badge>
          ) : (
            <Badge tone="ok" icon="check" title="Every ornament weighed and assayed by the Karatometer">
              Assayed
            </Badge>
          )
        }
      />

      <div className="grid gap-4 px-4 pb-4 desk:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="fb-wave relative flex flex-col justify-between overflow-hidden rounded-2xl bg-brand-hero px-5 py-4 text-white">
          <p className="text-2xs font-bold uppercase tracking-[0.16em] text-gold-300">Max loan amount</p>
          <p className="mt-1 text-[34px] font-bold leading-none tabular-nums">
            <AnimatedNumber value={t.max_loan_amount} format={(n) => formatINR(n)} />
          </p>
          <p className="mt-2 text-xs text-white/70">
            on {formatWeight(t.net_weight_g)} net across {plural(valuation.items.length, "ornament")}
          </p>
        </div>

        <div className="rounded-2xl border border-line px-4 py-3">
          {/* How much of the gross weight survives as net weight. */}
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-line/60" role="img" aria-label="Net weight as a share of the gross weight">
            {t.gross_weight_g > 0 && (
              <>
                <motion.div
                  initial={false}
                  animate={{ flexGrow: Math.max(netShare, 0.01) }}
                  transition={{ duration: 0.7, ease }}
                  style={{ background: "#004E96", flexBasis: 0 }}
                  title={`Net weight: ${formatWeight(t.net_weight_g)}`}
                />
                {t.wastage_g > 0 && (
                  <motion.div
                    initial={false}
                    animate={{ flexGrow: 1 - netShare }}
                    transition={{ duration: 0.7, ease }}
                    style={{ background: "#FAA619", flexBasis: 0 }}
                    title={`Wastage: ${formatWeight(t.wastage_g)}`}
                  />
                )}
              </>
            )}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">Gross weight</dt>
              <dd className="font-semibold tabular-nums text-ink">{formatWeight(t.gross_weight_g)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-ink-2">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: "#FAA619" }} /> Less wastage ({formatNumber(t.wastage_pct)}%)
              </dt>
              <dd className="tabular-nums text-ink-muted">−{formatWeight(t.wastage_g)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: "#004E96" }} /> Net weight
              </dt>
              <dd className="font-semibold tabular-nums text-ink">{formatWeight(t.net_weight_g)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">Rate per gram</dt>
              <dd className="tabular-nums text-ink">{formatINR(t.rate_per_gram)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-1.5">
              <dt className="font-semibold text-ink">Max loan amount</dt>
              <dd className="font-bold tabular-nums text-brand-700">{formatINR(t.max_loan_amount)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {t.unpriced.length > 0 && (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3.5 py-2 text-xs text-warn desk:mx-5">
          <Icon name="alert" size={14} className="mt-px shrink-0" />
          The Karatometer has not graded the purity of {t.unpriced.join(", ")} yet. The loan amount is unaffected — it
          follows the net weight — but the purity is still to confirm.
        </p>
      )}

      <p className="flex items-start gap-1.5 px-4 py-2.5 text-2xs text-ink-muted desk:px-5">
        <Icon name="lock" size={12} className="mt-px shrink-0" /> Per-ornament net weights are in the Pledged inventory
        table · the rate per gram and the wastage percentage were captured from Settings when this verification started.
        Indicative — not a sanction.
      </p>
    </Card>
  );
}
