"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import { cn, formatTime, formatWeight, plural } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { SessionView } from "@/lib/types";

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
  const settled = w.scale_status === "match" || w.scale_overridden;

  let machineCaption: ReactNode = "Upload the machine photo, or type the total";
  if (w.scale_source === "photo") {
    machineCaption = (
      <>
        Read from the machine photo
        {w.scale_text && <span className="font-mono"> · “{w.scale_text}”</span>}
      </>
    );
  } else if (w.scale_source === "assessor") {
    machineCaption = "Entered by the assessor";
  } else if (session.scale) {
    machineCaption = session.ai_enabled ? "Display not readable in the photo" : "Type the total from the display";
  }

  return (
    <div className="space-y-2.5">
      <div className="grid gap-3 md:grid-cols-3">
        <Tile
          icon="gem"
          label="Entered per item"
          value={formatWeight(w.entered_g)}
          caption={
            w.unweighed.length
              ? `${w.unweighed.length} still to weigh · ${w.unweighed.slice(0, 2).join(", ")}`
              : `${plural(session.stats.items, "ornament")} weighed at the counter`
          }
          tone={w.unweighed.length ? "warn" : "ok"}
        />
        <Tile
          icon="weighScale"
          label="Weighing machine"
          value={w.scale_g !== null ? formatWeight(w.scale_g) : <span className="text-ink-faint">—</span>}
          caption={machineCaption}
          tone={w.scale_status === "match" ? "ok" : w.scale_status === "mismatch" && !w.scale_overridden ? "warn" : "neutral"}
          action={
            !locked ? (
              <button
                type="button"
                onClick={() => openDialog({ kind: "scale" })}
                className="rounded-md px-1.5 py-0.5 text-2xs font-semibold text-brand-600 transition-colors hover:bg-brand-50"
              >
                {w.scale_g !== null ? "Correct" : "Type total"}
              </button>
            ) : undefined
          }
        />
        <Tile
          icon="cpu"
          label="CaratMeter"
          value={w.measured_g !== null ? formatWeight(w.measured_g) : <span className="text-ink-faint">—</span>}
          caption={
            session.measurements
              ? `${session.measurements.count} of ${plural(session.inventory.length, "ornament")} assayed · ${formatTime(session.measurements.measured_at)}`
              : "Awaiting the assay"
          }
          tone={session.measurements ? (w.flagged ? "warn" : "ok") : "neutral"}
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
                `The machine agrees with the weights entered (tolerance ±${formatWeight(w.tolerance_g)})`}
              {w.scale_status === "mismatch" &&
                `The machine differs from the weights entered by ${formatWeight(Math.abs(w.scale_diff_g ?? 0))} (tolerance ±${formatWeight(w.tolerance_g)})`}
              {w.scale_status === "missing" && "The machine display could not be read — type the total instead"}
              {w.scale_overridden && " — accepted by the assessor"}
            </span>
            {!locked && !w.scale_overridden && !settled && (
              <span className="flex gap-1.5">
                {w.scale_status === "missing" && (
                  <Button size="sm" variant="secondary" icon="pen" onClick={() => openDialog({ kind: "scale" })}>
                    Type total
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

function MeasurePrompt({ session }: { session: SessionView }) {
  const { runStep, openDialog, state } = useVerification();
  const canMeasure = session.allowed_actions.includes("measure");
  const w = session.weight;
  const ready = w.unweighed.length === 0 && session.inventory.length > 0;

  if (!canMeasure) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-faint">
          <Icon name="cpu" size={19} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-2">Next: weigh each ornament</p>
          <p className="text-xs text-ink-muted">
            Once the collateral photo has listed the ornaments, enter each weight, photograph the machine total, then ask the
            CaratMeter for the purity.
          </p>
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
        <p className="text-sm font-bold text-ink">
          {ready ? "Ask the CaratMeter for the purity" : `Weigh the remaining ${w.unweighed.length} ornament${w.unweighed.length === 1 ? "" : "s"} first`}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
          One request for this loan application sends every ornament id and returns each assay, graded against the valuation
          table and checked against the weight you entered (±{formatWeight(w.item_tolerance_g)} · {w.purity_tolerance_pct} pts margin).
        </p>
      </div>
      <span className="flex flex-wrap gap-2">
        {!session.scale && (
          <Button variant="secondary" icon="weighScale" disabled={!!state.busy} onClick={() => openDialog({ kind: "scale-photo" })}>
            Machine photo
          </Button>
        )}
        <Button variant="gold" icon="cpu" disabled={!!state.busy || !ready} onClick={() => runStep("measure")}>
          Fetch purity
        </Button>
      </span>
    </motion.div>
  );
}

export default function WeightPurityCard({ session }: { session: SessionView }) {
  const { state, runStep, openDialog } = useVerification();
  const locked = session.workflow_state === "done";
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
            <span>Weights entered here · machine photo for the total · {device?.model || session.caratmeter.model}</span>
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
                {w.flagged ? `${w.flagged} to review` : `${matches}/${session.inventory.length} assayed`}
              </Badge>
            )}
            {canMeasure && !locked && (
              <Button size="sm" variant="secondary" icon="weighScale" disabled={!!state.busy} onClick={() => openDialog({ kind: "scale-photo" })}>
                {session.scale ? "Re-take machine photo" : "Machine photo"}
              </Button>
            )}
            {canMeasure && measured && (
              <Button size="sm" variant="secondary" icon="refresh" loading={measuring} disabled={!!state.busy} onClick={() => runStep("measure")}>
                Re-assay
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4 px-5 pb-4">
        <Reconciliation session={session} />
        {!measured && !measuring && <MeasurePrompt session={session} />}
        {(measured || measuring) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-muted">
            <span className="flex items-center gap-1">
              <Icon name="info" size={12} /> Each ornament&apos;s assay is in the <span className="font-semibold text-ink-2">Pledged inventory</span> table below
            </span>
            <span>Tolerance ±{formatWeight(w.item_tolerance_g)} per item · purity margin {w.purity_tolerance_pct} pts</span>
            {device?.calibrated_at && <span>Calibrated {formatTime(device.calibrated_at)}</span>}
          </p>
        )}
      </div>
    </Card>
  );
}
