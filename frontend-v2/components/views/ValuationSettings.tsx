"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Controls";
import Icon from "@/components/ui/Icon";
import { cn, formatINR } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { AppSettings, MaterialConfig, PurityGrade } from "@/lib/types";

const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Materials added in this editing session (not yet saved) may still change their CBS code. */
type DraftMaterial = MaterialConfig & { _new?: boolean };

/** Errors on untouched empty fields stay quiet until the assessor tries to save. */
const shown = (issues: Record<string, string>, key: string, empty: boolean, showAll: boolean) => !!issues[key] && (showAll || !empty);

const inRange = (n: number, lo: number, hi: number, loExclusive = false) => Number.isFinite(n) && (loExclusive ? n > lo : n >= lo) && n <= hi;

/** Field-level problems keyed like "m0.name", "m1.g2.fineness", "weight_tolerance_g". Empty when valid. */
export function valuationIssues(draft: AppSettings): Record<string, string> {
  const issues: Record<string, string> = {};
  const keys = new Set<string>();
  draft.valuation.materials.forEach((m, mi) => {
    if (!m.name.trim()) issues[`m${mi}.name`] = "Enter a material name.";
    const key = slug(m.key);
    if (!key) issues[`m${mi}.key`] = "Enter a CBS material code.";
    else if (keys.has(key)) issues[`m${mi}.key`] = "Material codes must be unique.";
    keys.add(key);
    if (!m.grades.length) issues[`m${mi}.grades`] = "Add at least one purity grade.";
    const names = new Set<string>();
    m.grades.forEach((g, gi) => {
      const name = g.grade.trim().toUpperCase();
      if (!name) issues[`m${mi}.g${gi}.grade`] = "Enter the grade.";
      else if (names.has(name)) issues[`m${mi}.g${gi}.grade`] = "Grades must be unique.";
      names.add(name);
      if (!inRange(g.fineness_pct, 0, 100, true)) issues[`m${mi}.g${gi}.fineness`] = "Fineness must be above 0 and at most 100%.";
    });
  });
  if (!inRange(draft.weight_tolerance_g, 0, 5)) issues.weight_tolerance_g = "Tolerance must be 0–5 g.";
  if (!inRange(draft.purity_tolerance_pct, 0, 5)) issues.purity_tolerance_pct = "Margin must be 0–5 points.";
  return issues;
}

function NumberCell({
  value,
  onChange,
  invalid,
  label,
  step = 1,
  prefix,
  suffix,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  invalid?: boolean;
  label: string;
  step?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 items-center rounded-lg border bg-surface px-2.5 transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:shadow-focus",
        invalid ? "border-bad" : "border-line-strong",
        className
      )}
    >
      {prefix && <span className="mr-1 text-xs text-ink-muted">{prefix}</span>}
      <input
        type="number"
        step={step}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        aria-label={label}
        aria-invalid={invalid}
        className="w-full min-w-0 bg-transparent text-right text-sm font-semibold tabular-nums text-ink outline-none"
      />
      {suffix && <span className="ml-1 text-xs text-ink-muted">{suffix}</span>}
    </div>
  );
}

function TextCell({ value, onChange, invalid, label, placeholder, disabled, mono }: { value: string; onChange: (v: string) => void; invalid?: boolean; label: string; placeholder?: string; disabled?: boolean; mono?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={invalid}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={40}
      className={cn(
        "h-9 w-full rounded-lg border bg-surface px-2.5 text-sm font-semibold text-ink outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-ink-faint focus:border-brand-500 focus:shadow-focus disabled:border-line disabled:bg-subtle disabled:text-ink-muted",
        invalid ? "border-bad" : "border-line-strong",
        mono && "font-mono text-xs"
      )}
    />
  );
}

export function ValuationCard({
  draft,
  setDraft,
  issues,
  showAll,
}: {
  draft: AppSettings;
  setDraft: (next: AppSettings) => void;
  issues: Record<string, string>;
  showAll: boolean;
}) {
  const materials = draft.valuation.materials as DraftMaterial[];
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (active > materials.length - 1) setActive(Math.max(0, materials.length - 1));
  }, [active, materials.length]);

  const index = Math.min(active, materials.length - 1);
  const material = materials[index];

  const setMaterials = (next: DraftMaterial[]) => setDraft({ ...draft, valuation: { materials: next } });
  const updateMaterial = (patch: Partial<MaterialConfig>) => setMaterials(materials.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const updateGrade = (gi: number, patch: Partial<PurityGrade>) => updateMaterial({ grades: material.grades.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });

  const addMaterial = () => {
    setMaterials([...materials, { key: "", name: "", ltv_pct: 70, grades: [{ grade: "", fineness_pct: NaN, rate_per_gram: 0 }], _new: true }]);
    setActive(materials.length);
  };
  const removeMaterial = () => {
    setMaterials(materials.filter((_, i) => i !== index));
    setActive(Math.max(0, index - 1));
  };

  const see = (key: string, value: string | number) =>
    shown(issues, key, typeof value === "number" ? Number.isNaN(value) : !value.trim(), showAll);
  const firstIssue = material
    ? [
        see(`m${index}.name`, material.name) && issues[`m${index}.name`],
        see(`m${index}.key`, material.key) && issues[`m${index}.key`],
        see(`m${index}.ltv`, material.ltv_pct) && issues[`m${index}.ltv`],
        showAll && issues[`m${index}.grades`],
        ...material.grades.flatMap((g, gi) => [
          see(`m${index}.g${gi}.grade`, g.grade) && issues[`m${index}.g${gi}.grade`],
          see(`m${index}.g${gi}.fineness`, g.fineness_pct) && issues[`m${index}.g${gi}.fineness`],
        ]),
      ].find(Boolean)
    : undefined;
  const isNew = !!material?._new;

  return (
    <Card>
      <CardHeader
        icon="rupee"
        title="Purity grades"
        subtitle="The fineness each grade needs, per material · used to grade a Karatometer reading, not to price the loan"
        actions={
          <Button size="sm" variant="secondary" icon="plus" onClick={addMaterial} disabled={materials.length >= 10}>
            Add material
          </Button>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            layoutId="material-tab"
            size="sm"
            value={String(index)}
            onChange={(v) => setActive(Number(v))}
            options={materials.map((m, i) => ({
              value: String(i),
              label: `${m.name.trim() || "New material"}${showAll && Object.keys(issues).some((k) => k.startsWith(`m${i}.`)) ? " •" : ""}`,
            }))}
          />
        </div>

        {material && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={index} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease }} className="space-y-3">
              <div className="grid gap-3 rounded-xl border border-line bg-subtle p-3.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]">
                <label className="block">
                  <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-muted">Material</span>
                  <TextCell
                    label="Material name"
                    value={material.name}
                    placeholder="e.g. Platinum"
                    invalid={see(`m${index}.name`, material.name)}
                    onChange={(name) => updateMaterial({ name, ...(isNew ? { key: slug(name) } : {}) })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-muted" title="Must match the material code on CBS ornaments">
                    CBS material code
                  </span>
                  <TextCell label="CBS material code" value={material.key} mono disabled={!isNew} invalid={see(`m${index}.key`, material.key)} onChange={(key) => updateMaterial({ key })} />
                </label>
                <div className="flex items-end">
                  <Button size="sm" variant="ghost" icon="trash" disabled={materials.length <= 1} onClick={removeMaterial} className="h-9 text-bad hover:bg-bad-soft hover:text-bad">
                    Remove
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
                      <th className="py-2 pl-3.5 pr-2">Purity grade</th>
                      <th className="py-2 pr-2">Fineness</th>
                      <th className="w-10 py-2 pr-2" />
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {material.grades.map((g, gi) => {
                        return (
                          <motion.tr
                            key={gi}
                            layout="position"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-line last:border-b-0"
                          >
                            <td className="py-1.5 pl-3.5 pr-2">
                              <TextCell label={`Grade ${gi + 1}`} value={g.grade} placeholder="22K" invalid={see(`m${index}.g${gi}.grade`, g.grade)} onChange={(grade) => updateGrade(gi, { grade })} />
                            </td>
                            <td className="w-[130px] py-1.5 pr-2">
                              <NumberCell label={`Fineness for ${g.grade || "grade"}`} value={g.fineness_pct} step={0.1} suffix="%" invalid={see(`m${index}.g${gi}.fineness`, g.fineness_pct)} onChange={(fineness_pct) => updateGrade(gi, { fineness_pct })} />
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              <button
                                type="button"
                                aria-label={`Remove grade ${g.grade || gi + 1}`}
                                disabled={material.grades.length <= 1}
                                onClick={() => updateMaterial({ grades: material.grades.filter((_, i) => i !== gi) })}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-bad-soft hover:text-bad disabled:pointer-events-none disabled:opacity-30"
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle/60 px-3.5 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="plus"
                    disabled={material.grades.length >= 20}
                    onClick={() => updateMaterial({ grades: [...material.grades, { grade: "", fineness_pct: NaN, rate_per_gram: 0 }] })}
                  >
                    Add grade
                  </Button>
                  <span className="flex items-center gap-1 text-2xs text-ink-muted">
                    <Icon name="info" size={12} /> A Karatometer reading takes the highest grade whose fineness it reaches (within the purity margin).
                  </span>
                </div>
              </div>

              {firstIssue && (
                <p className="flex items-start gap-1.5 text-xs text-bad" role="alert">
                  <Icon name="info" size={13} className="mt-px shrink-0" /> {firstIssue}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </Card>
  );
}

/** The loan amount: one rate per gram, and the wastage taken off the gross weight. */
export function LoanAmountCard({ draft, setDraft }: { draft: AppSettings; setDraft: (next: AppSettings) => void }) {
  const example = 100;
  const net = example * (1 - (draft.wastage_pct || 0) / 100);
  return (
    <Card>
      <CardHeader
        icon="rupee"
        title="Loan amount"
        subtitle="Net weight (gross less wastage) × the rate per gram. Captured when a verification starts."
      />
      <div className="divide-y divide-line px-4 desk:px-5">
        <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
          <div className="min-w-0 max-w-[520px]">
            <p className="text-sm font-semibold text-ink">Rate per gram</p>
            <p className="text-xs text-ink-muted">Applied to the net weight of the whole pledge.</p>
          </div>
          <NumberCell
            label="Rate per gram"
            value={draft.rate_per_gram}
            step={50}
            prefix="₹"
            className="w-[150px]"
            onChange={(rate_per_gram) => setDraft({ ...draft, rate_per_gram })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
          <div className="min-w-0 max-w-[520px]">
            <p className="text-sm font-semibold text-ink">Wastage</p>
            <p className="text-xs text-ink-muted">Taken off the gross weight for solder, stones and impurities · allowed 0–25%.</p>
          </div>
          <NumberCell
            label="Wastage"
            value={draft.wastage_pct}
            step={0.5}
            suffix="%"
            className="w-[130px]"
            onChange={(wastage_pct) => setDraft({ ...draft, wastage_pct })}
          />
        </div>
        <div className="py-3.5">
          <Badge tone="brand">
            100 g gross → {net.toFixed(2)} g net → {formatINR(net * (draft.rate_per_gram || 0))}
          </Badge>
        </div>
      </div>
    </Card>
  );
}

export function MeasurementCard({ draft, setDraft, issues }: { draft: AppSettings; setDraft: (next: AppSettings) => void; issues: Record<string, string> }) {
  return (
    <Card>
      <CardHeader icon="weighScale" title="Weight & purity tolerances" subtitle="How Karatometer readings are compared with the weights on the pledge list" />
      <div className="divide-y divide-line px-5">
        {[
          {
            key: "weight_tolerance_g" as const,
            label: "Weight tolerance per item",
            hint: "Measured vs CBS weight difference allowed before an item is flagged. The scale reading is allowed this × the number of items.",
            step: 0.01,
            suffix: "g",
          },
          {
            key: "purity_tolerance_pct" as const,
            label: "Purity margin",
            hint: "Percentage points added to a fineness reading before grading (e.g. 91.2% + 0.5 still grades as 22K at 91.6%).",
            step: 0.1,
            suffix: "pts",
          },
        ].map((f) => (
          <div key={f.key} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
            <div className="min-w-0 max-w-[520px]">
              <p className="text-sm font-semibold text-ink">{f.label}</p>
              <p className="text-xs text-ink-muted">{f.hint} · allowed 0–5</p>
            </div>
            <NumberCell label={f.label} value={draft[f.key]} step={f.step} suffix={f.suffix} invalid={!!issues[f.key]} className="w-[130px]" onChange={(n) => setDraft({ ...draft, [f.key]: n })} />
          </div>
        ))}
      </div>
    </Card>
  );
}
