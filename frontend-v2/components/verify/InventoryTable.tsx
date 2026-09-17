"use client";

import { motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge, ItemBadge, ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { cn, formatWeight, plural, purityLabel } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { DamageEntry, InventoryItem, ItemStatus, SessionView } from "@/lib/types";

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

function IconAction({ icon, label, onClick, disabled }: { icon: "pen" | "alert" | "shieldCheck"; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

function ItemRow({ item, session, damage }: { item: InventoryItem; session: SessionView; damage?: DamageEntry }) {
  const { openDialog } = useVerification();
  const flash = useFlash(item.status);
  const locked = session.workflow_state === "done";
  const damagePending = session.cbs_damage_pending.includes(item.id);
  const canRecordDamage = session.allowed_actions.includes("damage");
  const hasPhotos = session.collateral.images.length > 0;

  return (
    <motion.tr
      layout="position"
      key={`${item.id}-${flash}`}
      initial={flash ? { backgroundColor: "rgba(250,166,25,0.16)" } : false}
      animate={{ backgroundColor: "rgba(250,166,25,0)" }}
      transition={{ duration: 1.4, ease }}
      className="group"
    >
      <td className={cn("py-2.5 pl-5 pr-3", damage ? "border-b-0" : "border-b border-line")}>
        <Thumb
          assetId={item.thumb_asset_id}
          alt={item.name}
          size={44}
          onClick={item.thumb_asset_id ? () => openDialog({ kind: "lightbox", src: assetUrl(item.thumb_asset_id), title: item.name, caption: "Cropped from the collateral photo" }) : undefined}
        />
      </td>
      <td className={cn("py-2.5 pr-3", damage ? "" : "border-b border-line")}>
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
      <td className={cn("py-2.5 pr-3 text-ink-2", damage ? "" : "border-b border-line")}>
        {purityLabel(item)}
        {item.material && item.material !== "gold" && <span className="block text-2xs capitalize text-ink-faint">{item.material}</span>}
      </td>
      <td className={cn("py-2.5 pr-3 tabular-nums text-ink-2", damage ? "" : "border-b border-line")}>{formatWeight(item.weight_gm)}</td>
      <td className={cn("py-2.5 pr-3", damage ? "" : "border-b border-line")}>
        <motion.span key={item.status} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 24 }} className="inline-block">
          <ItemBadge status={item.status} awaitingPhoto={!hasPhotos} />
        </motion.span>
      </td>
      <td className={cn("py-2.5 pr-4 text-right", damage ? "" : "border-b border-line")}>
        <div className="flex items-center justify-end gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
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
          {canRecordDamage && (
            <IconAction icon="alert" label={`Record damage for ${item.name}`} onClick={() => openDialog({ kind: "damage", ornamentId: item.id })} />
          )}
          {!locked && <IconAction icon="pen" label={`Correct ${item.name}`} onClick={() => openDialog({ kind: "edit", ref: item.id })} />}
        </div>
      </td>
    </motion.tr>
  );
}

const SEVERITY_TONE = { minor: "gold", moderate: "warn", severe: "bad" } as const;

function DamageRow({ damage, session }: { damage: DamageEntry; session: SessionView }) {
  const { openDialog } = useVerification();
  const needsOverride = (damage.status === "alert" || damage.status === "fail") && !damage.overridden && session.workflow_state !== "done";
  const aiChecked = damage.status !== "not_checked";

  return (
    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <td colSpan={6} className="border-b border-line px-5 pb-3 pt-0">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease }}
          className={cn(
            "ml-[56px] flex items-start gap-3 rounded-xl border px-3 py-2.5",
            damage.overridden ? "border-brand-200 bg-brand-50/60" : damage.status === "pass" || !aiChecked ? "border-line bg-subtle" : damage.status === "alert" ? "border-warn-line bg-warn-soft/60" : "border-bad-line bg-bad-soft/60"
          )}
        >
          <Thumb
            assetId={damage.thumb_asset_id}
            alt={`Damage on ${damage.item}`}
            size={52}
            fallback="alert"
            onClick={damage.asset_id ? () => openDialog({ kind: "lightbox", src: assetUrl(damage.asset_id), title: `Damage · ${damage.item}`, caption: `${damage.type} — ${damage.assessor_details || "no description"}` }) : undefined}
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

export default function InventoryTable({ session }: { session: SessionView }) {
  const { stats, inventory, damages } = session;
  const byItem = new Map(damages.map((d) => [d.ornament_id, d]));
  const pending = session.cbs_damage_pending.length;

  return (
    <Card id="card-inventory">
      <CardHeader
        icon="gem"
        title="Pledged inventory"
        subtitle={`From CBS · ${plural(stats.items, "item")} · ${plural(stats.pieces, "piece")} · ${formatWeight(stats.total_weight)}`}
        actions={
          <div className="flex items-center gap-2">
            {stats.pending > 0 && session.collateral.images.length > 0 && <Badge tone="warn" dot>{stats.pending} not sighted</Badge>}
            {pending > 0 && <Badge tone="gold" icon="alert">{pending} CBS damage to record</Badge>}
            {stats.damaged > 0 && <Badge tone="neutral">{plural(stats.damaged, "damage record")}</Badge>}
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-line bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
              <th className="w-[76px] py-2 pl-5" />
              <th className="py-2 pr-3">Item</th>
              <th className="py-2 pr-3">Purity</th>
              <th className="py-2 pr-3">Weight</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => {
                const damage = byItem.get(item.id);
                return (
                  <Fragment key={item.id}>
                    <ItemRow item={item} session={session} damage={damage} />
                    {damage && <DamageRow key={`${item.id}-damage-${damage.recorded_at}`} damage={damage} session={session} />}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="h-2" />
    </Card>
  );
}
