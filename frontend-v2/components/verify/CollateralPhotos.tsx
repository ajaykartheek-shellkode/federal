"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge, ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { CHECK_LABELS, cn, formatTime, formatWeight, plural } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { CaptureCheck, CollateralImage, SessionView } from "@/lib/types";

function PhotoCard({ image, session }: { image: CollateralImage; session: SessionView }) {
  const { openDialog } = useVerification();
  const checked = image.status !== "not_checked";
  const ring = { pass: "ring-ok-line", alert: "ring-warn-line", fail: "ring-bad-line", not_checked: "ring-line" }[image.status];
  const matchedNames = image.matched.map((id) => session.inventory.find((i) => i.id === id)?.name).filter(Boolean);
  const weighs = session.steps?.includes("weight");
  const scale = image.scale;
  const usedReading = session.scale?.source === "photo" && session.scale.photo_index === image.index;

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className={cn("flex overflow-hidden rounded-xl border border-line bg-surface ring-2 ring-inset", ring)}
    >
      <div className="relative min-h-[190px] w-[44%] shrink-0 bg-subtle">
        <div className="absolute inset-0">
          <Thumb
            assetId={image.asset_id}
            alt={`Collateral photo ${image.index + 1}`}
            rounded="rounded-none"
            fallback="image"
            className="h-full w-full border-0"
            onClick={() =>
              image.asset_id &&
              openDialog({
                kind: "lightbox",
                src: assetUrl(image.asset_id),
                title: `Collateral photo ${image.index + 1}`,
                caption: image.filename,
              })
            }
          />
        </div>
        <span className="absolute left-2 top-2">
          <ResultBadge status={image.status} className="shadow-xs" />
        </span>
        {weighs && scale?.visible && scale.weight_g !== null && (
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.2, ease }}
            className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-lg bg-brand-950/80 px-2 py-1 text-xs font-bold tabular-nums text-white shadow-raised backdrop-blur"
            title={scale.text ? `Display: ${scale.text}` : undefined}
          >
            <Icon name="weighScale" size={13} className="text-gold-400" /> {formatWeight(scale.weight_g)}
          </motion.span>
        )}
      </div>
      <div className="min-w-0 flex-1 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Photo {image.index + 1}</p>
          <span className="text-2xs text-ink-faint">
            Upload {image.upload_no} · {formatTime(image.uploaded_at)}
          </span>
        </div>
        {checked ? (
          <>
            <p className="mt-0.5 text-xs text-ink-muted">
              {plural(image.ornament_count_estimate, "piece")} detected · {plural(image.matched.length, "item")} matched
              {image.foreign_object_percent > 0 && ` · ${image.foreign_object_percent}% foreign objects`}
            </p>
            <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
              {(Object.keys(CHECK_LABELS) as CaptureCheck[]).map((key) => {
                const ok = image.checks[key];
                return (
                  <li key={key} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-ink-2" : "text-warn")}>
                    <Icon name={ok ? "checkCircle" : "alert"} size={13} className={ok ? "text-ok" : "text-warn"} />
                    {CHECK_LABELS[key]}
                  </li>
                );
              })}
              {weighs && (
                <li className={cn("col-span-2 flex items-center gap-1.5 text-xs", scale?.visible ? "text-ink-2" : "text-ink-muted")}>
                  <Icon name={scale?.visible ? "checkCircle" : "info"} size={13} className={cn("shrink-0", scale?.visible ? "text-ok" : "text-ink-faint")} />
                  {scale?.visible && scale.weight_g !== null ? (
                    <span className="min-w-0">
                      Scale display read <span className="font-semibold tabular-nums text-ink">{formatWeight(scale.weight_g)}</span>
                      {usedReading && <span className="text-ink-faint"> · used for reconciliation</span>}
                    </span>
                  ) : (
                    <span className="min-w-0">Scale display not readable in this photo</span>
                  )}
                </li>
              )}
            </ul>
            {image.issues.length > 0 && (
              <div className="mt-2.5 space-y-1 rounded-lg bg-warn-soft px-2.5 py-2">
                {image.issues.map((issue) => (
                  <p key={issue} className="flex gap-1.5 text-xs text-warn">
                    <Icon name="info" size={13} className="mt-px shrink-0" /> {issue}
                  </p>
                ))}
              </div>
            )}
            {matchedNames.length > 0 && (
              <p className="mt-2 truncate text-2xs text-ink-faint" title={matchedNames.join(", ")}>
                Matched: {matchedNames.join(", ")}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-ink-muted">Recorded for manual verification — AI validation is off for {session.loan.scenario}.</p>
        )}
      </div>
    </motion.article>
  );
}

export default function CollateralPhotos({ session }: { session: SessionView }) {
  const { openDialog } = useVerification();
  const { collateral, stats } = session;
  const canUpload = session.allowed_actions.includes("collateral");
  const sighted = stats.verified + stats.overridden;
  const latestUpload = Math.max(0, ...collateral.images.map((i) => i.upload_no));
  const latestFlagged = collateral.images.some((i) => i.upload_no === latestUpload && (i.status === "alert" || i.status === "fail"));

  return (
    <Card id="card-collateral">
      <CardHeader
        icon="camera"
        title="Collateral photos"
        subtitle="Clarity · visibility · cropping · obstruction · foreign objects · background"
        actions={
          <>
            {collateral.images.length > 0 && (
              <Badge tone={sighted === stats.items ? "ok" : "warn"} dot>
                {sighted}/{stats.items} sighted
              </Badge>
            )}
            {canUpload && collateral.images.length > 0 && (
              <Button size="sm" variant="secondary" icon="plus" onClick={() => openDialog({ kind: "collateral" })}>
                Add photos
              </Button>
            )}
          </>
        }
      />
      <div className="px-5 pb-5">
        {collateral.images.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong">
            <EmptyState
              icon="camera"
              title="No collateral photos yet"
              hint={
                session.steps?.includes("weight")
                  ? "Photograph all pledged ornaments together on the weighing scale with its display readable. The agent checks quality, reads the scale and matches every item to CBS."
                  : "Photograph all pledged ornaments together on a plain surface. The agent checks quality and matches every item to CBS."
              }
            />
            {canUpload && (
              <div className="-mt-3 flex justify-center pb-6">
                <Button variant="gold" icon="camera" onClick={() => openDialog({ kind: "collateral" })}>
                  Upload collateral photos
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-3 xl:grid-cols-2">
              <AnimatePresence initial={false}>
                {[...collateral.images].reverse().map((im) => (
                  <PhotoCard key={im.index} image={im} session={session} />
                ))}
              </AnimatePresence>
            </div>
            {latestFlagged && collateral.corrective_actions.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-start gap-2.5 rounded-xl bg-cream px-4 py-3">
                <Icon name="camera" size={16} className="mt-0.5 shrink-0 text-gold-600" />
                <div>
                  <p className="text-xs font-bold text-gold-700">To fix the capture</p>
                  <ul className="mt-0.5 list-disc pl-4 text-xs text-ink-2">
                    {collateral.corrective_actions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
