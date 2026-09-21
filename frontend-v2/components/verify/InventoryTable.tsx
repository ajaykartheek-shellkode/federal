"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge, ItemBadge, ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Controls";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { cn, formatINR, formatWeight, formatWeightDelta, MEASURE_META, plural, purityLabel } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { DamageEntry, InventoryItem, ItemStatus, SessionView, ValuedItem } from "@/lib/types";

/**
 * The single collateral table for the whole verification: one row per pledged item, with the
 * columns of the step in progress (sighting → weight & purity → valuation). Damage records appear
 * as a detail row under their item, so no step ever adds a second table.
 */
export type TableMode = "sighting" | "weight" | "valuation";

const MODES: { value: TableMode; label: string }[] = [
  { value: "sighting", label: "Sighting" },
  { value: "weight", label: "Weight & purity" },
  { value: "valuation", label: "Valuation" },
];

const FLAGGED = ["weight_mismatch", "purity_low", "mismatch", "missing"];

/** The columns that belong to the step the session is on. */
export function modeForStep(session: SessionView): TableMode {
  switch (session.workflow_state) {
    case "weight":
    case "damage": // the readings just fetched stay on screen; damage shows as a detail row
      return "weight";
    case "document":
    case "report":
    case "done":
      return "valuation";
    default:
      return "sighting";
  }
}

/** Flash a row when its sighting status changes (e.g. pending → verified). */
function useFlash(status: ItemStatus) {
  const prev = useRef(status);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (prev.current !== status) setFlash((n) => n + 1);
    prev.current = status;
  }, [status]);
  return flash;
}

function IconAction({ icon, label, onClick }: { icon: "pen" | "alert" | "shieldCheck"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-brand-50 hover:text-brand-700"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line py-2.5 pr-3 align-middle", className)}>{children}</td>;
}

function ItemRow({
  item,
  valued,
  session,
  mode,
  damage,
}: {
  item: InventoryItem;
  valued?: ValuedItem;
  session: SessionView;
  mode: TableMode;
  damage?: DamageEntry;
}) {
  const { openDialog } = useVerification();
  const flash = useFlash(item.status);
  const locked = session.workflow_state === "done";
  const damagePending = session.cbs_damage_pending.includes(item.id);
  const canRecordDamage = session.allowed_actions.includes("damage");
  const hasPhotos = session.collateral.images.length > 0;
  const m = item.measurement;
  const status = item.measurement_status ?? "pending";
  const flagged = FLAGGED.includes(status);
  const delta = m ? m.weight_g - item.weight_gm : 0;
  const weightOff = m && Math.abs(delta) > session.weight.item_tolerance_g + 1e-9;
  const border = damage ? "border-b-0" : "border-b border-line";

  return (
    <motion.tr
      layout="position"
      key={`${item.id}-${flash}`}
      initial={flash ? { backgroundColor: "rgba(250,166,25,0.16)" } : false}
      animate={{ backgroundColor: "rgba(250,166,25,0)" }}
      transition={{ duration: 1.4, ease }}
      className="group"
    >
      <td className={cn("py-2.5 pl-5 pr-3", border)}>
        <Thumb
          assetId={item.thumb_asset_id}
          alt={item.name}
          size={44}
          onClick={
            item.thumb_asset_id
              ? () => openDialog({ kind: "lightbox", src: assetUrl(item.thumb_asset_id), title: item.name, caption: "Cropped from the collateral photo" })
              : undefined
          }
        />
      </td>

      <td className={cn("py-2.5 pr-3", border)}>
        <p className="font-semibold text-ink">
          {item.name}
          {item.quantity > 1 && <span className="ml-1 text-xs font-normal text-ink-muted">×{item.quantity}</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-2 font-mono text-2xs text-ink-faint">
          {item.id}
          {item.cbs_damage && (
            <span className="font-sans" title={item.cbs_damage_details}>
              <Badge tone={damagePending ? "warn" : item.cbs_damage_waived ? "neutral" : "gold"}>
                {item.cbs_damage_waived ? "CBS damage waived" : "CBS: damage"}
              </Badge>
            </span>
          )}
        </p>
      </td>

      {mode === "sighting" && (
        <>
          <Cell className={cn(border, "text-ink-2")}>
            {purityLabel(item)}
            {item.material && item.material !== "gold" && <span className="block text-2xs capitalize text-ink-faint">{item.material}</span>}
          </Cell>
          <Cell className={cn(border, "tabular-nums text-ink-2")}>{formatWeight(item.weight_gm)}</Cell>
          <Cell className={border}>
            <motion.span
              key={item.status}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 24 }}
              className="inline-block"
            >
              <ItemBadge status={item.status} awaitingPhoto={!hasPhotos} />
            </motion.span>
          </Cell>
        </>
      )}

      {mode === "weight" && (
        <>
          <Cell className={cn(border, "whitespace-nowrap text-ink-2")}>
            <span className="font-semibold text-ink">{purityLabel(item)}</span> · {formatWeight(item.weight_gm)}
          </Cell>
          <Cell className={cn(border, "whitespace-nowrap")}>
            {m ? (
              <motion.span key={m.measured_at} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="inline-flex items-center gap-1.5">
                <span className={cn("font-semibold tabular-nums", weightOff ? "text-warn" : "text-ink")}>{formatWeight(m.weight_g)}</span>
                <span className="text-ink-faint">·</span>
                <span className="tabular-nums text-ink-muted">{m.fineness_pct.toFixed(2)}%</span>
                <Badge tone={!m.grade ? "bad" : m.grade.replace(/K$/, "") !== item.carat ? "warn" : "ok"}>{m.grade ?? "Ungraded"}</Badge>
              </motion.span>
            ) : (
              <span className="text-ink-faint">Not measured</span>
            )}
          </Cell>
          <Cell className={cn(border, "whitespace-nowrap text-right font-mono text-xs tabular-nums", weightOff ? "font-semibold text-warn" : "text-ink-muted")}>
            {m ? formatWeightDelta(delta) : "—"}
          </Cell>
          <Cell className={border}>
            {item.measurement_overridden ? (
              <Badge tone="brand" icon="pen" title={MEASURE_META[status].label}>
                Accepted
              </Badge>
            ) : (
              <Badge tone={MEASURE_META[status].tone} dot title={MEASURE_META[status].hint}>
                {MEASURE_META[status].label}
              </Badge>
            )}
          </Cell>
        </>
      )}

      {mode === "valuation" && (
        <>
          <Cell className={cn(border, "whitespace-nowrap text-right tabular-nums text-ink-2")}>
            {formatWeight(valued?.weight_g ?? item.weight_gm)}
            <span className={cn("block text-2xs", valued?.weight_basis === "measured" ? "text-ok" : "text-ink-faint")}>
              {valued?.weight_basis === "measured" ? "measured" : "declared"}
            </span>
          </Cell>
          <Cell className={border}>{valued?.grade ? <Badge tone="neutral">{valued.grade}</Badge> : <Badge tone="bad">No rate</Badge>}</Cell>
          <Cell className={cn(border, "whitespace-nowrap text-right tabular-nums text-ink-2")}>{formatINR(valued?.rate_per_gram ?? 0)}</Cell>
          <Cell className={cn(border, "whitespace-nowrap text-right tabular-nums text-ink-muted")}>
            {valued && valued.damage_deduction > 0 ? `−${formatINR(valued.damage_deduction)}` : "—"}
            {item.damage_percent > 0 && <span className="block text-2xs text-ink-faint">CBS {item.damage_percent}</span>}
          </Cell>
          <Cell className={cn(border, "whitespace-nowrap text-right font-semibold tabular-nums text-ink")}>{formatINR(valued?.pledge_amount ?? 0)}</Cell>
        </>
      )}

      <td className={cn("py-2.5 pr-4 text-right", border)}>
        <div className="flex items-center justify-end gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
          {mode === "weight" && flagged && !item.measurement_overridden && !locked && (
            <Button size="sm" variant="secondary" icon="shieldCheck" onClick={() => openDialog({ kind: "override", target: "measurement", ref: item.id })}>
              Accept
            </Button>
          )}
          {item.status === "pending" && hasPhotos && !locked && (
            <Button size="sm" variant="secondary" icon="shieldCheck" onClick={() => openDialog({ kind: "override", target: "item", ref: item.id })}>
              Confirm
            </Button>
          )}
          {damagePending && !locked && !["collateral", "weight"].includes(session.workflow_state) && (
            <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: "override", target: "damage", ref: item.id })}>
              Waive
            </Button>
          )}
          {canRecordDamage && <IconAction icon="alert" label={`Record damage for ${item.name}`} onClick={() => openDialog({ kind: "damage", ornamentId: item.id })} />}
          {!locked && <IconAction icon="pen" label={`Correct ${item.name}`} onClick={() => openDialog({ kind: "edit", ref: item.id })} />}
        </div>
      </td>
    </motion.tr>
  );
}

const SEVERITY_TONE = { minor: "gold", moderate: "warn", severe: "bad" } as const;

function DamageRow({ damage, session, columns }: { damage: DamageEntry; session: SessionView; columns: number }) {
  const { openDialog } = useVerification();
  const needsOverride = (damage.status === "alert" || damage.status === "fail") && !damage.overridden && session.workflow_state !== "done";
  const aiChecked = damage.status !== "not_checked";

  return (
    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <td colSpan={columns} className="border-b border-line px-5 pb-3 pt-0">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease }}
          className={cn(
            "ml-[56px] flex items-start gap-3 rounded-xl border px-3 py-2.5",
            damage.overridden
              ? "border-brand-200 bg-brand-50/60"
              : damage.status === "pass" || !aiChecked
                ? "border-line bg-subtle"
                : damage.status === "alert"
                  ? "border-warn-line bg-warn-soft/60"
                  : "border-bad-line bg-bad-soft/60"
          )}
        >
          <Thumb
            assetId={damage.thumb_asset_id}
            alt={`Damage on ${damage.item}`}
            size={52}
            fallback="alert"
            onClick={
              damage.asset_id
                ? () =>
                    openDialog({
                      kind: "lightbox",
                      src: assetUrl(damage.asset_id),
                      title: `Damage · ${damage.item}`,
                      caption: `${damage.type} — ${damage.assessor_details || "no description"}`,
                    })
                : undefined
            }
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Icon name="alert" size={13} className="text-warn" />
              <span className="text-xs font-bold text-ink">{damage.type}</span>
              <Badge tone={SEVERITY_TONE[damage.severity]}>{damage.severity}</Badge>
              {damage.assessor_details && <span className="truncate text-xs text-ink-2">“{damage.assessor_details}”</span>}
            </div>
            {aiChecked ? (
              <div className="mt-1 space-y-0.5 text-xs text-ink-2">
                {damage.observed.length > 0 && (
                  <p>
                    <span className="font-semibold text-ink">AI observed:</span> {damage.observed.join("; ")}
                    {damage.assessed_severity && damage.assessed_severity !== "none" && <span className="text-ink-muted"> · {damage.assessed_severity}</span>}
                  </p>
                )}
                {damage.notes && <p className="text-ink-muted">{damage.notes}</p>}
                {damage.capture_issues.length > 0 && <p className="text-warn">{damage.capture_issues.join(" · ")}</p>}
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">Recorded without AI assessment.</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <ResultBadge status={damage.status} overridden={damage.overridden} />
            {aiChecked && damage.consistent !== null && !damage.overridden && (
              <span className={cn("text-2xs font-semibold", damage.consistent ? "text-ok" : "text-warn")}>
                {damage.consistent ? "Matches description" : "Not confirmed"}
              </span>
            )}
            {needsOverride && (
              <Button size="sm" variant="secondary" icon="pen" onClick={() => openDialog({ kind: "override", target: "damage", ref: damage.ornament_id })}>
                Override
              </Button>
            )}
          </div>
        </motion.div>
      </td>
    </motion.tr>
  );
}

const HEADERS: Record<TableMode, { label: string; align?: "right" }[]> = {
  sighting: [{ label: "Purity" }, { label: "Weight" }, { label: "Status" }],
  weight: [{ label: "CBS declared" }, { label: "CaratMeter reading" }, { label: "Δ weight", align: "right" }, { label: "Result" }],
  valuation: [
    { label: "Weight", align: "right" },
    { label: "Grade" },
    { label: "Rate / g", align: "right" },
    { label: "Damage", align: "right" },
    { label: "Pledge", align: "right" },
  ],
};

export default function InventoryTable({ session }: { session: SessionView }) {
  const { stats, inventory, damages, valuation } = session;
  const byItem = new Map(damages.map((d) => [d.ornament_id, d]));
  const valuedById = new Map(valuation.items.map((v) => [v.ornament_id, v]));
  const cbsPending = session.cbs_damage_pending.length;
  const step = modeForStep(session);
  const [mode, setMode] = useState<TableMode>(step);
  const stepRef = useRef(step);

  // The table follows the workflow; a manual switch holds until the next step begins.
  useEffect(() => {
    if (stepRef.current !== step) {
      stepRef.current = step;
      setMode(step);
    }
  }, [step]);

  const headers = HEADERS[mode];
  const columns = headers.length + 3;
  const totals = valuation.totals;

  const subtitle =
    mode === "valuation"
      ? `${plural(stats.items, "item")} · ${formatWeight(totals.weight_g)} ${totals.is_estimate ? "declared" : "measured"} · ${formatINR(totals.pledge_amount)}`
      : mode === "weight"
        ? `${stats.measured}/${stats.items} measured · tolerance ±${formatWeight(session.weight.item_tolerance_g)} · ${session.weight.purity_tolerance_pct} pts purity`
        : `From CBS · ${plural(stats.items, "item")} · ${plural(stats.pieces, "piece")} · ${formatWeight(stats.total_weight)}`;

  return (
    <Card id="card-inventory">
      <CardHeader
        icon="gem"
        title="Pledged inventory"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode === "sighting" && stats.pending > 0 && session.collateral.images.length > 0 && (
              <Badge tone="warn" dot>
                {stats.pending} not sighted
              </Badge>
            )}
            {mode === "weight" && session.weight.flagged > 0 && (
              <Badge tone="warn" dot>
                {session.weight.flagged} to review
              </Badge>
            )}
            {mode === "valuation" && (
              <Badge tone={totals.is_estimate ? "gold" : "ok"} icon={totals.is_estimate ? "info" : "check"}>
                {totals.is_estimate ? "Estimate" : "Measured"}
              </Badge>
            )}
            {cbsPending > 0 && (
              <Badge tone="gold" icon="alert">
                {cbsPending} CBS damage to record
              </Badge>
            )}
            <Segmented layoutId="inventory-mode" size="sm" value={mode} options={MODES} onChange={setMode} />
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-line bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
              <th className="w-[76px] py-2 pl-5" />
              <th className="py-2 pr-3">Item</th>
              {headers.map((h) => (
                <th key={h.label} className={cn("py-2 pr-3", h.align === "right" && "text-right")}>
                  {h.label}
                </th>
              ))}
              <th className="py-2 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {inventory.map((item) => {
                const damage = byItem.get(item.id);
                return (
                  <Fragment key={item.id}>
                    <ItemRow item={item} valued={valuedById.get(item.id)} session={session} mode={mode} damage={damage} />
                    {damage && <DamageRow key={`${item.id}-damage-${damage.recorded_at}`} damage={damage} session={session} columns={columns} />}
                  </Fragment>
                );
              })}
            </AnimatePresence>
          </tbody>
          {mode === "valuation" && (
            <tfoot>
              <tr className="bg-subtle/70">
                <td />
                <td className="py-2.5 pr-3 font-bold text-ink">Total</td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-ink">{formatWeight(totals.weight_g)}</td>
                <td colSpan={2} />
                <td className="py-2.5 pr-3 text-right tabular-nums text-ink-muted">
                  {totals.damage_deduction > 0 ? `−${formatINR(totals.damage_deduction)}` : "—"}
                </td>
                <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-brand-700">{formatINR(totals.pledge_amount)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="h-2" />
    </Card>
  );
}
