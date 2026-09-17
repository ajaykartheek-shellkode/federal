"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge, ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { AnimatedNumber } from "@/components/ui/Controls";
import Icon, { type IconName } from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { cn, formatDate, formatDateTime, formatINR, plural } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { CountTriple, CountsByKind, OverviewReport, ResultStatus, RunImage, RunRecord } from "@/lib/types";

// Status mark colours (validated for CVD separation; amber relies on labels/tooltips for contrast).
export const STATUS_MARK = { pass: "#0E9258", alert: "#E08D00", fail: "#D0342C" } as const;
const STATUS_ICON: Record<keyof typeof STATUS_MARK, IconName> = { pass: "checkCircle", alert: "alert", fail: "xCircle" };
const STATUS_LABEL = { pass: "Passed", alert: "Review", fail: "Failed" } as const;

export function StatTile({ label, value, format, hint, icon }: { label: string; value: number; format?: (n: number) => string; hint?: string; icon: IconName }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <Icon name={icon} size={14} className="text-brand-500" /> {label}
      </p>
      <p className="mt-1.5 text-[28px] font-bold leading-none text-ink">
        <AnimatedNumber value={value} format={format} />
      </p>
      {hint && <p className="mt-1 text-2xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4" aria-label="Legend">
      {(Object.keys(STATUS_MARK) as (keyof typeof STATUS_MARK)[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5 text-xs text-ink-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STATUS_MARK[s] }} />
          <Icon name={STATUS_ICON[s]} size={12} className="text-ink-muted" />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

/** 2px-gapped proportion bar for a pass/alert/fail triple, with counts as text. */
export function StatusSplit({ label, icon, counts }: { label: string; icon: IconName; counts: CountTriple }) {
  const total = counts.pass + counts.alert + counts.fail;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name={icon} size={16} className="text-brand-500" /> {label}
        </p>
        <span className="text-xs text-ink-muted">{plural(total, "check")}</span>
      </div>
      <div className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-line/60">
        {total > 0 &&
          (["pass", "alert", "fail"] as const).map(
            (s) =>
              counts[s] > 0 && (
                <motion.div
                  key={s}
                  initial={{ flexGrow: 0 }}
                  animate={{ flexGrow: counts[s] }}
                  transition={{ duration: 0.7, ease }}
                  style={{ background: STATUS_MARK[s], flexBasis: 0 }}
                  title={`${STATUS_LABEL[s]}: ${counts[s]}`}
                />
              )
          )}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {(["pass", "alert", "fail"] as const).map((s) => (
          <div key={s}>
            <p className="text-lg font-bold leading-tight text-ink">{counts[s]}</p>
            <p className="flex items-center gap-1 text-2xs text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_MARK[s] }} /> {STATUS_LABEL[s]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CategorySplits({ counts }: { counts: CountsByKind }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatusSplit label="Collateral photos" icon="camera" counts={counts.collateral} />
      <StatusSplit label="Damaged collateral" icon="alert" counts={counts.damage} />
      <StatusSplit label="Documentary proof" icon="idCard" counts={counts.document} />
    </div>
  );
}

/** Stacked daily outcome columns with a per-column hover tooltip. */
export function OutcomeChart({ days }: { days: OverviewReport["days"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.runs));
  const niceMax = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const ticks = niceMax <= 4 ? Array.from({ length: niceMax + 1 }, (_, i) => i) : [0, niceMax / 2, niceMax];
  const HEIGHT = 168;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Verification outcomes</p>
          <p className="text-xs text-ink-muted">Sessions per day, by overall result</p>
        </div>
        <StatusLegend />
      </div>
      <div className="relative flex gap-3">
        <div className="relative w-6 shrink-0 text-right text-2xs tabular-nums text-ink-faint" style={{ height: HEIGHT }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: HEIGHT - (t / niceMax) * HEIGHT }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-line/70" style={{ top: HEIGHT - (t / niceMax) * HEIGHT }} />
          ))}
          <div className="relative flex items-end justify-around" style={{ height: HEIGHT }}>
            {days.map((d, i) => {
              const segments = (["pass", "alert", "fail"] as const).filter((s) => d[s] > 0);
              const top = segments[segments.length - 1];
              return (
                <div
                  key={d.date}
                  className="relative flex h-full flex-1 cursor-default items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${formatDate(d.date)}: ${d.runs} sessions, ${d.pass} passed, ${d.alert} review, ${d.fail} failed`}
                >
                  {hover === i && <div className="absolute inset-x-1 bottom-0 top-0 rounded-md bg-brand-50/70" />}
                  <div className="relative flex w-full max-w-[24px] flex-col-reverse gap-[2px]">
                    {segments.map((s, si) => (
                      <motion.div
                        key={s}
                        initial={{ height: 0 }}
                        animate={{ height: Math.max(3, (d[s] / niceMax) * HEIGHT - (si > 0 ? 2 : 0)) }}
                        transition={{ duration: 0.6, delay: i * 0.04, ease }}
                        className={cn(s === top && "rounded-t-[4px]")}
                        style={{ background: STATUS_MARK[s] }}
                      />
                    ))}
                  </div>
                  <AnimatePresence>
                    {hover === i && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="pointer-events-none absolute bottom-full z-10 mb-2 w-40 rounded-xl border border-line bg-surface p-2.5 shadow-raised"
                      >
                        <p className="text-xs font-semibold text-ink">{formatDate(d.date)}</p>
                        <p className="mb-1 text-2xs text-ink-muted">{plural(d.runs, "session")}</p>
                        {(["pass", "alert", "fail"] as const).map((s) => (
                          <p key={s} className="flex items-center justify-between text-xs text-ink-2">
                            <span className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-[2px]" style={{ background: STATUS_MARK[s] }} /> {STATUS_LABEL[s]}
                            </span>
                            <span className="font-semibold tabular-nums text-ink">{d[s]}</span>
                          </p>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-around">
            {days.map((d) => (
              <span key={d.date} className="flex-1 text-center text-2xs text-ink-muted">
                {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit" })}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageGroup({ title, images, contentTypes }: { title: string; images: (RunImage & { caption: string })[]; contentTypes?: (string | undefined)[] }) {
  const { openDialog } = useVerification();
  return (
    <div>
      <p className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-muted">{title}</p>
      {images.length === 0 ? (
        <p className="text-xs text-ink-faint">None</p>
      ) : (
        <div className="space-y-2">
          {images.map((im, idx) => (
            <div key={idx} className="flex items-start gap-2.5">
              <div className="relative">
                <Thumb
                  assetId={im.asset_id}
                  alt={im.caption}
                  size={46}
                  contentType={contentTypes?.[idx]}
                  fallback="image"
                  onClick={im.asset_id ? () => openDialog({ kind: "lightbox", src: assetUrl(im.asset_id), title: im.caption, contentType: contentTypes?.[idx] }) : undefined}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{im.caption}</p>
                <ResultBadge status={(im.status as ResultStatus) ?? "not_checked"} overridden={(im as { overridden?: boolean }).overridden} className="mt-0.5" />
                {im.issues?.length > 0 && <p className="mt-0.5 text-2xs leading-snug text-warn">{im.issues.join(" · ")}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RunCard({ run, defaultOpen = false }: { run: RunRecord; defaultOpen?: boolean }) {
  const { resume, setView, state } = useVerification();
  const [open, setOpen] = useState(defaultOpen);
  const rec = run.summary.recommendation;
  const stats = run.summary.stats;

  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-xl border border-line bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-subtle">
        <span
          className="h-9 w-1 shrink-0 rounded-full"
          style={{ background: STATUS_MARK[run.overall_status] ?? "#A2ACBC" }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {run.loan.customer_name} <span className="font-mono text-xs font-normal text-ink-muted">· {run.loan.account_number}</span>
          </p>
          <p className="truncate text-xs text-ink-muted">
            {formatDateTime(run.created_at)} · {run.loan.scenario}
            {stats && ` · ${plural(stats.items, "item")} · ${stats.damaged} damaged`}
            {typeof run.summary.pledge_amount === "number" && ` · Pledge ${formatINR(run.summary.pledge_amount)}`}
            {run.summary.report_id && <span className="font-mono"> · {run.summary.report_id}</span>}
          </p>
        </div>
        {run.summary.ai_enabled === false && <Badge tone="neutral">AI off</Badge>}
        {rec && (
          <Badge tone={rec === "PROCEED" ? "ok" : "gold"} icon={rec === "PROCEED" ? "check" : "flag"}>
            {rec}
          </Badge>
        )}
        <ResultBadge status={run.overall_status} />
        <Icon name="chevronDown" size={16} className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
            <div className="border-t border-line bg-subtle/60 px-4 py-4">
              {run.summary.reasons && run.summary.reasons.length > 0 && (
                <ul className="mb-4 space-y-1">
                  {run.summary.reasons.map((r) => (
                    <li key={r.text} className="flex gap-2 text-xs text-ink-2">
                      <Icon name={r.level === "warn" ? "alert" : "info"} size={13} className={cn("mt-px shrink-0", r.level === "warn" ? "text-warn" : "text-brand-500")} />
                      {r.text}
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-5 md:grid-cols-3">
                <ImageGroup title="Collateral" images={run.collateral_images.map((i) => ({ ...i, caption: `Photo ${i.index + 1}` }))} />
                <ImageGroup title="Damaged collateral" images={run.damage_images.map((i) => ({ ...i, caption: i.ornament_name }))} />
                <ImageGroup title="Documentary proof" images={run.documents.map((i) => ({ ...i, caption: i.doc_type }))} contentTypes={run.documents.map((d) => d.content_type)} />
              </div>
              {run.session_id && (
                <div className="mt-4 flex justify-end gap-2">
                  {run.summary.report_id && (
                    <a
                      href={`/report/${run.session_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                    >
                      <Icon name="doc" size={14} /> View report
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    iconRight="arrowRight"
                    disabled={!!state.busy}
                    onClick={async () => {
                      setView("verify");
                      await resume(run.session_id!);
                    }}
                  >
                    Open verification
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
