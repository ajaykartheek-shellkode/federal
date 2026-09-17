"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { cn, formatTime, formatWeight, formatWeightDelta, MEASURE_META, plural, purityLabel } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { InventoryItem, MeasurementStatus, SessionView } from "@/lib/types";

const FLAGGED: MeasurementStatus[] = ["weight_mismatch", "purity_low", "mismatch", "missing"];
const norm = (grade: string | null | undefined) => String(grade ?? "").toUpperCase().replace(/K$/, "");

function Tile({
  icon,
  label,
  value,
  caption,
  tone = "neutral",
  action,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  caption: ReactNode;
  tone?: "neutral" | "ok" | "warn";
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 rounded-xl border bg-surface px-4 py-3 transition-colors duration-300",
        tone === "ok" ? "border-ok-line" : tone === "warn" ? "border-warn-line" : "border-line"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-ink-muted">
          <Icon name={icon} size={13} className="text-brand-500" /> {label}
        </p>
        {action}
      </div>
      <p className="mt-1 text-[22px] font-bold leading-tight tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 truncate text-2xs text-ink-muted">{caption}</p>
    </div>
  );
}

function Reconciliation({ session }: { session: SessionView }) {
  const { openDialog } = useVerification();
  const w = session.weight;
  const locked = session.workflow_state === "done";
  const hasPhotos = session.collateral.images.length > 0;
  const basis = w.measured_complete ? "CaratMeter" : "CBS-declared";
  const settled = w.scale_status === "match" || w.scale_overridden;

  let scaleCaption: ReactNode = "Captured with the collateral photo";
  if (w.scale_source === "photo") {
    scaleCaption = (
      <>
        Read from photo {(w.scale_photo ?? 0) + 1}
        {w.scale_text && <span className="font-mono"> · “{w.scale_text}”</span>}
      </>
    );
  } else if (w.scale_source === "assessor") {
    scaleCaption = "Entered by the assessor";
  } else if (hasPhotos) {
    scaleCaption = session.ai_enabled ? "Display not readable in the photos" : "Enter it from the scale display";
  }

  return (
    <div className="space-y-2.5">
      <div className="grid gap-3 md:grid-cols-3">
        <Tile
          icon="weighScale"
          label="Weighing scale"
          value={w.scale_g !== null ? formatWeight(w.scale_g) : <span className="text-ink-faint">—</span>}
          caption={scaleCaption}
          tone={w.scale_status === "match" ? "ok" : w.scale_status === "mismatch" && !w.scale_overridden ? "warn" : "neutral"}
          action={
            hasPhotos && !locked ? (
              <button
                type="button"
                onClick={() => openDialog({ kind: "scale" })}
                className="rounded-md px-1.5 py-0.5 text-2xs font-semibold text-brand-600 transition-colors hover:bg-brand-50"
              >
                {w.scale_g !== null ? "Correct" : "Enter"}
              </button>
            ) : undefined
          }
        />
        <Tile
          icon="cpu"
          label="CaratMeter total"
          value={w.measured_g !== null ? formatWeight(w.measured_g) : <span className="text-ink-faint">—</span>}
          caption={
            session.measurements
              ? `${session.measurements.count} of ${plural(session.inventory.length, "item")} · ${formatTime(session.measurements.measured_at)}`
              : "Awaiting readings"
          }
          tone={session.measurements ? (w.flagged ? "warn" : "ok") : "neutral"}
        />
        <Tile
          icon="bank"
          label="CBS declared"
          value={formatWeight(w.declared_g)}
          caption={`${plural(session.stats.items, "item")} · ${plural(session.stats.pieces, "piece")}`}
        />
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {w.scale_status !== "pending" && (
          <motion.div
            key={`${w.scale_status}-${w.scale_overridden}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease }}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-3.5 py-2 text-xs",
              w.scale_overridden ? "bg-brand-50 text-brand-700" : settled ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
            )}
          >
            <Icon name={w.scale_overridden ? "pen" : settled ? "checkCircle" : "alert"} size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 font-semibold">
              {w.scale_status === "match" &&
                `Scale reading agrees with the ${basis} total (tolerance ±${formatWeight(w.tolerance_g)})`}
              {w.scale_status === "mismatch" &&
                `Scale reading differs from the ${basis} total by ${formatWeight(Math.abs(w.scale_diff_g ?? 0))} (tolerance ±${formatWeight(w.tolerance_g)})`}
              {w.scale_status === "missing" && "No weighing-scale reading captured for this collateral"}
              {w.scale_overridden && " — accepted by the assessor"}
            </span>
            {!locked && !w.scale_overridden && !settled && (
              <span className="flex gap-1.5">
                {w.scale_status === "missing" && (
                  <Button size="sm" variant="secondary" icon="pen" onClick={() => openDialog({ kind: "scale" })}>
                    Enter reading
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: "override", target: "scale", ref: "scale" })}>
                  Accept
                </Button>
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return <span className={cn("skeleton inline-block h-3.5 rounded", className)} />;
}

function ReadingRow({ item, session, measuring, index }: { item: InventoryItem; session: SessionView; measuring: boolean; index: number }) {
  const { openDialog } = useVerification();
  const m = item.measurement;
  const status = item.measurement_status ?? "pending";
  const meta = MEASURE_META[status];
  const flagged = FLAGGED.includes(status);
  const locked = session.workflow_state === "done";
  const delta = m ? m.weight_g - item.weight_gm : 0;
  const weightOff = m && Math.abs(delta) > session.weight.item_tolerance_g + 1e-9;
  const gradeLower = m && norm(m.grade) !== norm(item.carat);
  const cell = "border-b border-line py-2.5 pr-3 align-middle";

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
      className={cn(flagged && !item.measurement_overridden && !measuring && "bg-warn-soft/35")}
    >
      <td className={cn(cell, "pl-5")}>
        <div className="flex items-center gap-2.5">
          <Thumb assetId={item.thumb_asset_id} alt={item.name} size={34} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {item.name}
              {item.quantity > 1 && <span className="ml-1 text-xs font-normal text-ink-muted">×{item.quantity}</span>}
            </p>
            <p className="font-mono text-2xs text-ink-faint">{m?.sample_id || item.id}</p>
          </div>
        </div>
      </td>
      <td className={cn(cell, "whitespace-nowrap text-ink-2")}>
        <span className="font-semibold text-ink">{purityLabel(item)}</span>
        <span className="text-ink-muted"> · {formatWeight(item.weight_gm)}</span>
        {item.material !== "gold" && (
          <span className="ml-1.5 align-middle">
            <Badge tone="neutral">{item.material}</Badge>
          </span>
        )}
      </td>
      <td className={cn(cell, "whitespace-nowrap")}>
        {measuring ? (
          <span className="flex items-center gap-2">
            <Shimmer className="w-16" />
            <Shimmer className="w-10" />
          </span>
        ) : m ? (
          <motion.span key={m.measured_at} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="inline-flex items-center gap-1.5">
            <span className={cn("font-semibold tabular-nums", weightOff ? "text-warn" : "text-ink")}>{formatWeight(m.weight_g)}</span>
            <span className="text-ink-faint">·</span>
            <span className="tabular-nums text-ink-muted" title={m.karat !== null ? `${m.karat}K equivalent` : undefined}>
              {m.fineness_pct.toFixed(2)}%
            </span>
            <Badge tone={!m.grade ? "bad" : gradeLower ? "warn" : "ok"}>{m.grade ?? "Ungraded"}</Badge>
          </motion.span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </td>
      <td className={cn(cell, "whitespace-nowrap text-right font-mono text-xs tabular-nums", weightOff && !measuring ? "font-semibold text-warn" : "text-ink-muted")}>
        {measuring ? <Shimmer className="w-12" /> : m ? formatWeightDelta(delta) : "—"}
      </td>
      <td className={cn(cell, "pl-3")}>
        {measuring ? (
          <Badge tone="gold" dot>
            Measuring
          </Badge>
        ) : item.measurement_overridden ? (
          <Badge tone="brand" icon="pen" title={meta.label}>
            Accepted
          </Badge>
        ) : (
          <Badge tone={meta.tone} dot title={meta.hint}>
            {meta.label}
          </Badge>
        )}
      </td>
      <td className={cn(cell, "pr-5 text-right")}>
        {flagged && !item.measurement_overridden && !locked && !measuring && (
          <Button size="sm" variant="secondary" icon="shieldCheck" onClick={() => openDialog({ kind: "override", target: "measurement", ref: item.id })}>
            Accept
          </Button>
        )}
      </td>
    </motion.tr>
  );
}

function MeasurePrompt({ session }: { session: SessionView }) {
  const { runStep, state } = useVerification();
  const canMeasure = session.allowed_actions.includes("measure");
  const w = session.weight;

  if (!canMeasure) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-faint">
          <Icon name="cpu" size={19} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-2">Next: CaratMeter readings</p>
          <p className="text-xs text-ink-muted">Once the collateral photos are verified, each ornament is measured for net weight and XRF purity.</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease }}
      className="flex flex-wrap items-center gap-4 rounded-xl border border-gold-200 bg-cream px-5 py-4"
    >
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface text-brand-600 shadow-xs ring-1 ring-gold-200">
        <Icon name="cpu" size={24} />
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-cream bg-ok" title="Device connected" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">Place each ornament on the CaratMeter</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
          Net weight and XRF purity are read per item, graded against the valuation table and compared with CBS (±
          {formatWeight(w.item_tolerance_g)} weight · {w.purity_tolerance_pct} pts purity margin).
        </p>
      </div>
      <Button variant="gold" icon="weighScale" disabled={!!state.busy} onClick={() => runStep("measure")}>
        Fetch readings
      </Button>
    </motion.div>
  );
}

export default function WeightPurityCard({ session }: { session: SessionView }) {
  const { state, runStep } = useVerification();
  const w = session.weight;
  const measuring = Object.values(state.runs).some((r) => r.agent === "weight" && !r.done);
  const canMeasure = session.allowed_actions.includes("measure");
  const measured = !!session.measurements;
  const device = session.measurements?.device;
  const matches = w.counts.match ?? 0;

  return (
    <Card id="card-weight">
      <CardHeader
        icon="weighScale"
        title="Weight & purity"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{device?.model || session.caratmeter.model}</span>
            <span className="font-mono">· {device?.device_id || session.caratmeter.device_id}</span>
            <span className="inline-flex items-center gap-1">
              · <span className="h-1.5 w-1.5 rounded-full bg-ok" /> {session.caratmeter.mode === "mock" ? "Simulated device" : "Device gateway"}
            </span>
          </span>
        }
        actions={
          <>
            {measured && !measuring && (
              <Badge tone={w.flagged ? "warn" : "ok"} dot>
                {w.flagged ? `${w.flagged} to review` : `${matches}/${session.inventory.length} match`}
              </Badge>
            )}
            {canMeasure && measured && (
              <Button size="sm" variant="secondary" icon="refresh" loading={measuring} disabled={!!state.busy} onClick={() => runStep("measure")}>
                Re-measure
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4 px-5 pb-4">
        <Reconciliation session={session} />
        {!measured && !measuring && <MeasurePrompt session={session} />}
      </div>

      <AnimatePresence initial={false}>
        {(measured || measuring) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease }} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-line bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
                    <th className="py-2 pl-5 pr-3">Item</th>
                    <th className="py-2 pr-3">CBS declared</th>
                    <th className="py-2 pr-3">CaratMeter reading</th>
                    <th className="py-2 pr-3 text-right">Δ weight</th>
                    <th className="py-2 pl-3 pr-3">Result</th>
                    <th className="py-2 pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {session.inventory.map((item, i) => (
                    <ReadingRow key={item.id} item={item} session={session} measuring={measuring} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-2xs text-ink-muted">
              <span className="flex items-center gap-1">
                <Icon name="info" size={12} /> Tolerance ±{formatWeight(w.item_tolerance_g)} per item · purity margin {w.purity_tolerance_pct} pts
              </span>
              {device?.calibrated_at && <span>Calibrated {formatTime(device.calibrated_at)}</span>}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
