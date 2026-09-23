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

/** Purity as people read it: gold "22" → "22K"; silver "925" stays "925"; unknown → "—". */
export function purityLabel(item: Pick<InventoryItem, "carat" | "material">): string {
  const carat = String(item.carat ?? "");
  if (!carat) return "—";
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
  detected: { label: "From photo", tone: "ok", hint: "Listed from the collateral photo by the agent" },
  manual: { label: "Added", tone: "brand", hint: "Added to the list by the assessor" },
};

export const MEASURE_META: Record<MeasurementStatus, { label: string; tone: Tone; hint: string }> = {
  pending: { label: "Not assayed", tone: "neutral", hint: "Fetch the readings from the CaratMeter" },
  match: { label: "Assayed", tone: "ok", hint: "Purity graded, and the device weight agrees with the weight entered" },
  weight_mismatch: { label: "Weight differs", tone: "warn", hint: "The device weight is outside tolerance of the weight entered" },
  ungraded: { label: "Below grades", tone: "warn", hint: "The assayed purity is below every grade configured for this material" },
  mismatch: { label: "Weight & purity", tone: "warn", hint: "The device weight differs and the purity is below every grade" },
  missing: { label: "No reading", tone: "bad", hint: "The CaratMeter returned no usable reading for this ornament" },
};

export const DAMAGE_DEDUCTION_META: Record<DamageDeduction, { label: string; hint: string }> = {
  tenths: { label: "Tenths of a percent", hint: "damage 10 → 1% deduction" },
  percent: { label: "Direct percentage", hint: "damage 10 → 10% deduction" },
  none: { label: "No deduction", hint: "damage is recorded but not deducted" },
};

export const WORKFLOW_STEPS: { key: WorkflowState; label: string; short: string }[] = [
  { key: "collateral", label: "Collateral photos", short: "Collateral" },
  { key: "weight", label: "Weight & purity", short: "Weight" },
  { key: "damage", label: "Damage assessment", short: "Damage" },
  { key: "valuation", label: "Pledge valuation", short: "Pledge" },
  { key: "document", label: "Document verification", short: "Documents" },
  { key: "report", label: "Report", short: "Report" },
];

export const AGENT_LABEL: Record<string, string> = {
  collateral: "Collateral Validator",
  scale: "Weighing Machine",
  weight: "CaratMeter · Purity",
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
