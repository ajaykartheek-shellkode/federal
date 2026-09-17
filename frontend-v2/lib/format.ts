// Formatting + status vocabulary shared across the UI.

import type { DamageDeduction, InventoryItem, ItemStatus, MeasurementStatus, ResultStatus, WorkflowState } from "./types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export const formatINR = (value: number) => inr.format(Math.round(value || 0));
export const formatNumber = (value: number) => num.format(value || 0);
export const formatWeight = (grams: number) => `${num.format(grams || 0)} g`;
const signed = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
/** "+0.02 g" / "−0.62 g" / "0 g" */
export const formatWeightDelta = (grams: number) => `${signed.format(Math.round((grams || 0) * 1000) / 1000).replace("-", "−")} g`;

/** Declared purity as people read it: gold "22" → "22K"; silver "925" stays "925". */
export function purityLabel(item: Pick<InventoryItem, "carat" | "material">): string {
  const carat = String(item.carat ?? "");
  return (item.material ?? "gold") === "gold" && /^\d+(\.\d+)?$/.test(carat) ? `${carat}K` : carat;
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

export type Tone = "ok" | "warn" | "bad" | "brand" | "neutral" | "gold";

export const RESULT_META: Record<ResultStatus, { label: string; tone: Tone }> = {
  pass: { label: "Passed", tone: "ok" },
  alert: { label: "Review", tone: "warn" },
  fail: { label: "Failed", tone: "bad" },
  not_checked: { label: "Not checked", tone: "neutral" },
};

export const ITEM_META: Record<ItemStatus, { label: string; tone: Tone; hint: string }> = {
  pending: { label: "Not sighted", tone: "warn", hint: "Not yet matched in a collateral photo" },
  verified: { label: "Verified", tone: "ok", hint: "Sighted and cross-verified by the AI agent" },
  overridden: { label: "Overridden", tone: "brand", hint: "Confirmed by the assessor with justification" },
  manual: { label: "Confirmed", tone: "neutral", hint: "Confirmed by the assessor (AI validation off)" },
};

export const MEASURE_META: Record<MeasurementStatus, { label: string; tone: Tone; hint: string }> = {
  pending: { label: "Not measured", tone: "neutral", hint: "Fetch readings from the CaratMeter" },
  match: { label: "Match", tone: "ok", hint: "Weight and purity agree with CBS within tolerance" },
  weight_mismatch: { label: "Weight differs", tone: "warn", hint: "Measured weight is outside the tolerance of the CBS weight" },
  purity_low: { label: "Lower purity", tone: "warn", hint: "Assessed purity grade is below the CBS declaration" },
  mismatch: { label: "Weight & purity differ", tone: "warn", hint: "Both weight and purity differ from CBS" },
  missing: { label: "No reading", tone: "bad", hint: "The CaratMeter returned no usable reading for this item" },
};

export const DAMAGE_DEDUCTION_META: Record<DamageDeduction, { label: string; hint: string }> = {
  tenths: { label: "Tenths of a percent", hint: "CBS damage 10 → 1% deduction" },
  percent: { label: "Direct percentage", hint: "CBS damage 10 → 10% deduction" },
  none: { label: "No deduction", hint: "CBS damage is recorded but not deducted" },
};

export const WORKFLOW_STEPS: { key: WorkflowState; label: string; short: string }[] = [
  { key: "collateral", label: "Collateral photos", short: "Collateral" },
  { key: "weight", label: "Weight & purity", short: "Weight" },
  { key: "damage", label: "Damage assessment", short: "Damage" },
  { key: "document", label: "Document verification", short: "Documents" },
  { key: "report", label: "Report", short: "Report" },
];

export const AGENT_LABEL: Record<string, string> = {
  collateral: "Collateral Validator",
  weight: "CaratMeter · Weight & Purity",
  damage: "Damage Detector",
  document: "Document Verifier",
  report: "Report Generator",
};

export const CHECK_LABELS: Record<string, string> = {
  clarity_ok: "Image clarity",
  all_visible: "All ornaments visible",
  not_cropped: "Nothing cropped",
  no_obstruction: "No obstruction",
  no_foreign_objects: "No foreign objects",
  clean_background: "Clean background",
};

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
