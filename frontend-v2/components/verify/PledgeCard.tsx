"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { AnimatedNumber } from "@/components/ui/Controls";
import Icon from "@/components/ui/Icon";
import { cn, DAMAGE_DEDUCTION_META, formatINR, formatWeight, plural } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { SessionView } from "@/lib/types";

// Proportion of the gross value: what is lent, the LTV margin kept by the bank, and the damage deduction.
const SEGMENTS = [
  { key: "pledge", label: "Pledge amount", row: "Pledge amount", color: "#004E96" },
  { key: "margin", label: "LTV margin", row: "Less LTV margin", color: "#CBD5E2" },
  { key: "damage", label: "Damage deduction", row: "Less damage deduction", color: "#FAA619" },
] as const;

export default function PledgeCard({ session }: { session: SessionView }) {
  const { valuation } = session;
  const t = valuation.totals;
  const margin = Math.max(0, t.gross_value - t.pledge_amount - t.damage_deduction);
  const parts = { pledge: t.pledge_amount, margin, damage: t.damage_deduction };
  const usedMaterials = new Set(valuation.items.map((i) => i.material));
  const ltvs = valuation.materials.filter((m) => usedMaterials.has(m.name));
  const deduction = DAMAGE_DEDUCTION_META[valuation.damage_deduction_mode];

  return (
    <Card id="card-pledge">
      <CardHeader
        icon="rupee"
        title="Pledge valuation"
        subtitle={
          <>
            {ltvs.map((m) => `${m.name} LTV ${m.ltv_pct}%`).join(" · ")} · Damage: {deduction.hint}
          </>
        }
        actions={
          t.is_estimate ? (
            <Badge tone="gold" icon="info" title="Valued on CBS-declared weight and purity until the CaratMeter readings are fetched">
              Estimate · CBS weight
            </Badge>
          ) : (
            <Badge tone="ok" icon="check" title="Valued on CaratMeter weight and assessed purity">
              Measured
            </Badge>
          )
        }
      />

      <div className="grid gap-4 px-5 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="fb-wave relative flex flex-col justify-between overflow-hidden rounded-2xl bg-brand-hero px-5 py-4 text-white">
          <p className="text-2xs font-bold uppercase tracking-[0.16em] text-gold-300">Pledge amount</p>
          <p className="mt-1 text-[34px] font-bold leading-none tabular-nums">
            <AnimatedNumber value={t.pledge_amount} format={(n) => formatINR(n)} />
          </p>
          <p className="mt-2 text-xs text-white/70">
            on {formatWeight(t.weight_g)} {t.is_estimate ? "declared" : "measured"} · {plural(valuation.items.length, "item")}
          </p>
        </div>

        <div className="rounded-2xl border border-line px-4 py-3">
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-line/60" role="img" aria-label="Split of gross value">
            {t.gross_value > 0 &&
              SEGMENTS.map(
                (s) =>
                  parts[s.key] > 0 && (
                    <motion.div
                      key={s.key}
                      initial={false}
                      animate={{ flexGrow: parts[s.key] }}
                      transition={{ duration: 0.7, ease }}
                      style={{ background: s.color, flexBasis: 0 }}
                      title={`${s.label}: ${formatINR(parts[s.key])}`}
                    />
                  )
              )}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">Gross value <span className="text-2xs text-ink-muted">(weight × rate)</span></dt>
              <dd className="font-semibold tabular-nums text-ink">{formatINR(t.gross_value)}</dd>
            </div>
            {SEGMENTS.slice(1).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-ink-2">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} /> {s.row}
                </dt>
                <dd className="tabular-nums text-ink-muted">−{formatINR(parts[s.key])}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-line pt-1.5">
              <dt className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: SEGMENTS[0].color }} /> Pledge amount
              </dt>
              <dd className="font-bold tabular-nums text-brand-700">{formatINR(t.pledge_amount)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {t.unpriced.length > 0 && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2 text-xs text-bad">
          <Icon name="alert" size={14} className="mt-px shrink-0" />
          No rate is configured for the purity of {t.unpriced.join(", ")} — valued at ₹0. Add the grade in Settings → Pledge valuation.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-line bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
              <th className="py-2 pl-5 pr-3">Item</th>
              <th className="py-2 pr-3 text-right">Weight</th>
              <th className="py-2 pr-3">Grade</th>
              <th className="py-2 pr-3 text-right">Rate / g</th>
              <th className="py-2 pr-3 text-right">Gross value</th>
              <th className="py-2 pr-3 text-right">LTV</th>
              <th className="py-2 pr-3 text-right">Damage</th>
              <th className="py-2 pr-5 text-right">Pledge</th>
            </tr>
          </thead>
          <tbody>
            {valuation.items.map((v) => (
              <tr key={v.ornament_id} className={cn(v.unpriced && "bg-bad-soft/40")}>
                <td className="border-b border-line py-2 pl-5 pr-3">
                  <p className="font-semibold text-ink">{v.name}</p>
                  <p className="text-2xs text-ink-muted">{v.material}</p>
                </td>
                <td className="whitespace-nowrap border-b border-line py-2 pr-3 text-right tabular-nums text-ink-2">
                  {formatWeight(v.weight_g)}
                  <span className={cn("block text-2xs", v.weight_basis === "measured" ? "text-ok" : "text-ink-faint")}>
                    {v.weight_basis === "measured" ? "measured" : "declared"}
                  </span>
                </td>
                <td className="border-b border-line py-2 pr-3">{v.grade ? <Badge tone="neutral">{v.grade}</Badge> : <Badge tone="bad">No rate</Badge>}</td>
                <td className="whitespace-nowrap border-b border-line py-2 pr-3 text-right tabular-nums text-ink-2">{formatINR(v.rate_per_gram)}</td>
                <td className="whitespace-nowrap border-b border-line py-2 pr-3 text-right tabular-nums text-ink-2">{formatINR(v.gross_value)}</td>
                <td className="border-b border-line py-2 pr-3 text-right tabular-nums text-ink-muted">{v.ltv_pct}%</td>
                <td className="whitespace-nowrap border-b border-line py-2 pr-3 text-right tabular-nums text-ink-muted">
                  {v.damage_deduction > 0 ? `−${formatINR(v.damage_deduction)}` : "—"}
                  {v.damage_percent > 0 && <span className="block text-2xs text-ink-faint">CBS {v.damage_percent}</span>}
                </td>
                <td className="whitespace-nowrap border-b border-line py-2 pr-5 text-right font-semibold tabular-nums text-ink">{formatINR(v.pledge_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-subtle/70 text-sm">
              <td className="py-2.5 pl-5 pr-3 font-bold text-ink">Total</td>
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-ink">{formatWeight(t.weight_g)}</td>
              <td colSpan={2} />
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-ink">{formatINR(t.gross_value)}</td>
              <td />
              <td className="py-2.5 pr-3 text-right tabular-nums text-ink-muted">{t.damage_deduction > 0 ? `−${formatINR(t.damage_deduction)}` : "—"}</td>
              <td className="py-2.5 pr-5 text-right font-bold tabular-nums text-brand-700">{formatINR(t.pledge_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="flex items-center gap-1.5 px-5 py-2.5 text-2xs text-ink-muted">
        <Icon name="lock" size={12} /> Rates, LTV and the damage rule were captured from Settings when this verification started. Indicative — not a sanction.
      </p>
    </Card>
  );
}
