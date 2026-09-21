"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge, ItemBadge, ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { cn, formatINR, formatWeight, MEASURE_META, plural, purityLabel } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { DamageEntry, InventoryItem, ItemStatus, SessionView, ValuedItem } from "@/lib/types";

/**
 * The one collateral table of the verification: a row per pledged item, gaining the columns of
 * each step as it completes — sighting, then the CaratMeter reading, then damage, then the pledge
 * amount. Damage records open as a detail row under their item, so no step adds a second table.
 */
const FLAGGED = ["weight_mismatch", "purity_low", "mismatch", "missing"];

interface RowContext {
  item: InventoryItem;
  valued?: ValuedItem;
  damage?: DamageEntry;
  session: SessionView;
}

interface Column {
  key: string;
  header: string;
  align?: "right";
  width?: string;
  cell: (ctx: RowContext) => ReactNode;
  footer?: ReactNode;
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

function IconAction({ icon, label, onClick }: { icon: "pen" | "alert"; label: string; onClick: () => void }) {
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

function DamageChip({ item, damage }: { item: InventoryItem; damage?: DamageEntry }) {
  if (damage) return <ResultBadge status={damage.status} overridden={damage.overridden} />;
  if (item.cbs_damage) {
    return item.cbs_damage_waived ? (
      <Badge tone="neutral" title="CBS-declared damage waived by the assessor">
        Waived
      </Badge>
    ) : (
      <Badge tone="warn" dot title={item.cbs_damage_details}>
        Not recorded
      </Badge>
    );
  }
  return <span className="text-ink-faint">—</span>;
}

function ItemRow({ ctx, columns }: { ctx: RowContext; columns: Column[] }) {
  const flash = useFlash(ctx.item.status);
  const border = ctx.damage ? "border-b-0" : "border-b border-line";

  return (
    <motion.tr
      layout="position"
      key={`${ctx.item.id}-${flash}`}
      initial={flash ? { backgroundColor: "rgba(250,166,25,0.16)" } : false}
      animate={{ backgroundColor: "rgba(250,166,25,0)" }}
      transition={{ duration: 1.4, ease }}
      className="group"
    >
      {columns.map((col, i) => (
        <td
          key={col.key}
          className={cn(
            "py-2.5 align-middle",
            border,
            i === 0 ? "pl-5 pr-3" : i === columns.length - 1 ? "pr-4" : "pr-3",
            col.align === "right" && "text-right"
          )}
        >
          {col.cell(ctx)}
        </td>
      ))}
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

export default function InventoryTable({ session }: { session: SessionView }) {
  const { openDialog } = useVerification();
  const { stats, inventory, damages, valuation, weight } = session;
  const byItem = new Map(damages.map((d) => [d.ornament_id, d]));
  const valuedById = new Map(valuation.items.map((v) => [v.ornament_id, v]));
  const locked = session.workflow_state === "done";
  const hasPhotos = session.collateral.images.length > 0;
  const canRecordDamage = session.allowed_actions.includes("damage");
  const totals = valuation.totals;

  // Columns appear as their step is reached, and stay for the rest of the verification.
  const steps: string[] = session.steps ?? [];
  const reached = (step: string) => {
    if (session.workflow_state === "done") return true;
    const at = steps.indexOf(session.workflow_state);
    const of = steps.indexOf(step);
    return of >= 0 && at >= of;
  };
  const showReading = reached("weight") && (!!session.measurements || session.workflow_state === "weight");
  const showDamage = reached("damage") || damages.length > 0;
  const showPledge = steps.includes("valuation") ? reached("valuation") : reached("document");

  const columns: Column[] = [
    {
      key: "thumb",
      header: "",
      width: "w-[76px]",
      cell: ({ item }) => (
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
      ),
    },
    {
      key: "item",
      header: "Item",
      footer: <span className="font-bold text-ink">Total</span>,
      cell: ({ item }) => (
        <>
          <p className="font-semibold text-ink">
            {item.name}
            {item.quantity > 1 && <span className="ml-1 text-xs font-normal text-ink-muted">×{item.quantity}</span>}
          </p>
          <p className="mt-0.5 font-mono text-2xs text-ink-faint">{item.id}</p>
        </>
      ),
    },
    {
      key: "declared",
      header: "CBS declared",
      footer: <span className="font-semibold tabular-nums text-ink">{formatWeight(stats.total_weight)}</span>,
      cell: ({ item }) => (
        <span className="whitespace-nowrap text-ink-2">
          <span className="font-semibold text-ink">{purityLabel(item)}</span> · {formatWeight(item.weight_gm)}
          {item.material && item.material !== "gold" && <span className="block text-2xs capitalize text-ink-faint">{item.material}</span>}
        </span>
      ),
    },
    {
      key: "sighting",
      header: "Sighting",
      cell: ({ item }) => (
        <motion.span
          key={item.status}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className="inline-block"
        >
          <ItemBadge status={item.status} awaitingPhoto={!hasPhotos} />
        </motion.span>
      ),
    },
  ];

  if (showReading) {
    columns.push(
      {
        // Purity only — the weights are reconciled on the Weight & purity card.
        key: "reading",
        header: "CaratMeter purity",
        cell: ({ item }) => {
          const m = item.measurement;
          if (!m) return <span className="text-ink-faint">Not measured</span>;
          return (
            <motion.span key={m.measured_at} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-semibold tabular-nums text-ink">{m.fineness_pct.toFixed(2)}%</span>
              <Badge tone={!m.grade ? "bad" : m.grade.replace(/K$/, "") !== item.carat ? "warn" : "ok"}>{m.grade ?? "Ungraded"}</Badge>
            </motion.span>
          );
        },
      },
      {
        key: "result",
        header: "Reading",
        cell: ({ item }) => {
          const status = item.measurement_status ?? "pending";
          return item.measurement_overridden ? (
            <Badge tone="brand" icon="pen" title={MEASURE_META[status].label}>
              Accepted
            </Badge>
          ) : (
            <Badge tone={MEASURE_META[status].tone} dot title={MEASURE_META[status].hint}>
              {MEASURE_META[status].label}
            </Badge>
          );
        },
      }
    );
  }

  if (showDamage) {
    columns.push({
      key: "damage",
      header: "Damage",
      cell: ({ item, damage }) => <DamageChip item={item} damage={damage} />,
    });
  }

  if (showPledge) {
    columns.push({
      key: "pledge",
      header: "Pledge",
      align: "right",
      footer: <span className="font-bold tabular-nums text-brand-700">{formatINR(totals.pledge_amount)}</span>,
      cell: ({ valued }) => (
        <span className="whitespace-nowrap">
          <span className="font-semibold tabular-nums text-ink">{formatINR(valued?.pledge_amount ?? 0)}</span>
          <span className={cn("block text-2xs", valued?.weight_basis === "measured" ? "text-ok" : "text-ink-faint")}>
            {valued?.weight_basis === "measured" ? "on measured wt" : "on declared wt"}
          </span>
        </span>
      ),
    });
  }

  columns.push({
    key: "actions",
    header: "Actions",
    align: "right",
    cell: ({ item }) => {
      const flagged = FLAGGED.includes(item.measurement_status ?? "pending") && !item.measurement_overridden;
      const damagePending = session.cbs_damage_pending.includes(item.id);
      return (
        <div className="flex items-center justify-end gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
          {showReading && flagged && !locked && (
            <Button size="sm" variant="secondary" icon="shieldCheck" onClick={() => openDialog({ kind: "override", target: "measurement", ref: item.id })}>
              Accept
            </Button>
          )}
          {item.status === "pending" && hasPhotos && !locked && (
            <Button size="sm" variant="secondary" icon="shieldCheck" onClick={() => openDialog({ kind: "override", target: "item", ref: item.id })}>
              Confirm
            </Button>
          )}
          {damagePending && !locked && showDamage && (
            <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: "override", target: "damage", ref: item.id })}>
              Waive
            </Button>
          )}
          {canRecordDamage && <IconAction icon="alert" label={`Record damage for ${item.name}`} onClick={() => openDialog({ kind: "damage", ornamentId: item.id })} />}
          {!locked && <IconAction icon="pen" label={`Correct ${item.name}`} onClick={() => openDialog({ kind: "edit", ref: item.id })} />}
        </div>
      );
    },
  });

  const subtitle = [
    `From CBS · ${plural(stats.items, "item")} · ${plural(stats.pieces, "piece")} · ${formatWeight(stats.total_weight)}`,
    showReading && weight.measured_g !== null ? `CaratMeter ${formatWeight(weight.measured_g)}` : null,
    showPledge ? `pledge ${formatINR(totals.pledge_amount)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card id="card-inventory">
      <CardHeader
        icon="gem"
        title="Pledged inventory"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {stats.pending > 0 && hasPhotos && (
              <Badge tone="warn" dot>
                {stats.pending} not sighted
              </Badge>
            )}
            {showReading && weight.flagged > 0 && (
              <Badge tone="warn" dot>
                {weight.flagged} reading{weight.flagged === 1 ? "" : "s"} to review
              </Badge>
            )}
            {session.cbs_damage_pending.length > 0 && (
              <Badge tone="gold" icon="alert">
                {session.cbs_damage_pending.length} CBS damage to record
              </Badge>
            )}
            {showPledge && (
              <Badge tone={totals.is_estimate ? "gold" : "ok"} icon={totals.is_estimate ? "info" : "check"}>
                {totals.is_estimate ? "Estimate" : "Measured"}
              </Badge>
            )}
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-line bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={cn("py-2", col.width, i === 0 ? "pl-5 pr-3" : i === columns.length - 1 ? "pr-4" : "pr-3", col.align === "right" && "text-right")}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {inventory.map((item) => {
                const damage = byItem.get(item.id);
                const ctx: RowContext = { item, valued: valuedById.get(item.id), damage, session };
                return (
                  <Fragment key={item.id}>
                    <ItemRow ctx={ctx} columns={columns} />
                    {damage && <DamageRow key={`${item.id}-damage-${damage.recorded_at}`} damage={damage} session={session} columns={columns.length} />}
                  </Fragment>
                );
              })}
            </AnimatePresence>
          </tbody>
          {showPledge && (
            <tfoot>
              <tr className="bg-subtle/70">
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={cn("py-2.5", i === 0 ? "pl-5 pr-3" : i === columns.length - 1 ? "pr-4" : "pr-3", col.align === "right" && "text-right")}
                  >
                    {col.footer ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="h-2" />
    </Card>
  );
}
