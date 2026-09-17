"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Controls";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import { ApiError, fetchSettings, saveSettings } from "@/lib/api";
import { cn } from "@/lib/format";
import type { AppSettings } from "@/lib/types";
import { MeasurementCard, ValuationCard, valuationIssues } from "./ValuationSettings";

type NumericKey = "max_ornaments_per_image" | "foreign_object_threshold_pct" | "doc_match_threshold_pct";

const THRESHOLDS: { key: NumericKey; label: string; hint: string; min: number; max: number; unit: string }[] = [
  { key: "max_ornaments_per_image", label: "Max ornaments per photo", hint: "Above this, the agent suggests splitting the set across photos", min: 1, max: 50, unit: "items" },
  { key: "foreign_object_threshold_pct", label: "Foreign-object threshold", hint: "Photos with more foreign-object coverage are flagged", min: 0, max: 100, unit: "%" },
  { key: "doc_match_threshold_pct", label: "Address match threshold", hint: "Document address similarity below this is flagged", min: 50, max: 100, unit: "%" },
];

const SCENARIO_HINT: Record<string, string> = {
  "Fresh Loan": "New gold loan bookings",
  Renewal: "Renewal of an existing gold loan",
  "Security Operations": "Collateral release / substitution",
};

export default function SettingsView() {
  const { toast } = useVerification();
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSaved(s);
        setDraft(s);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load settings."));
  }, []);

  const dirty = useMemo(() => !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  const issues = useMemo(() => (draft ? valuationIssues(draft) : {}), [draft]);
  const invalid = draft
    ? THRESHOLDS.some((t) => !(draft[t.key] >= t.min && draft[t.key] <= t.max && Number.isInteger(draft[t.key]))) || Object.keys(issues).length > 0
    : false;

  const save = async () => {
    if (!draft) return;
    if (invalid) {
      setAttempted(true);
      toast("warn", "Fix the highlighted values to save.");
      return;
    }
    setSaving(true);
    try {
      const { scenarios: _ignored, ...patch } = draft;
      // Drop editor-only markers (e.g. "_new" on materials added in this session).
      patch.valuation = { materials: patch.valuation.materials.map(({ key, name, ltv_pct, grades }) => ({ key, name, ltv_pct, grades })) };
      const next = await saveSettings(patch);
      setSaved(next);
      setDraft(next);
      setAttempted(false);
      toast("ok", "Settings saved");
    } catch (e) {
      toast("bad", e instanceof ApiError ? e.message : "Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-sm text-bad">
          <Icon name="xCircle" size={16} /> {error}
        </div>
      </div>
    );
  }
  if (!draft || !saved) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-sm text-ink-muted">
        <Spinner /> Loading settings…
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] space-y-5 px-8 pb-28 pt-7">
        <div>
          <h1 className="text-2xl font-bold text-ink">Settings</h1>
          <p className="text-sm text-ink-muted">Control where AI validation runs, how findings are enforced, the checking thresholds and how collateral is valued.</p>
        </div>

        <Card>
          <CardHeader icon="sparkles" title="AI validation by loan scenario" subtitle="Applies to verifications started after saving" />
          <div className="divide-y divide-line px-5 pb-2">
            {draft.scenarios.map((name) => (
              <div key={name} className="flex items-center justify-between gap-4 py-3.5">
                <div>
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  <p className="text-xs text-ink-muted">
                    {SCENARIO_HINT[name] ?? "Loan scenario"} ·{" "}
                    <span className={draft.aws_enabled[name] ? "text-ok" : "text-ink-faint"}>
                      {draft.aws_enabled[name] ? "AI checks every capture" : "Captures recorded for manual verification"}
                    </span>
                  </p>
                </div>
                <Toggle
                  label={`AI validation for ${name}`}
                  checked={!!draft.aws_enabled[name]}
                  onChange={(v) => setDraft({ ...draft, aws_enabled: { ...draft.aws_enabled, [name]: v } })}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon="shield" title="Enforcement mode" subtitle="Applies to verifications started after saving" />
          <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
            {[
              { value: false, title: "Alert mode", icon: "info" as const, text: "Findings are advisory. The assessor can continue at every step; issues are listed in the report for review." },
              { value: true, title: "Blocker mode", icon: "lock" as const, text: "Unusable photos or documents, unsighted items and undocumented CBS damage must be fixed, overridden or waived before continuing." },
            ].map((opt) => {
              const active = draft.blocker_mode === opt.value;
              return (
                <button
                  key={opt.title}
                  type="button"
                  onClick={() => setDraft({ ...draft, blocker_mode: opt.value })}
                  aria-pressed={active}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-colors",
                    active ? "border-brand-500 bg-brand-50/60" : "border-line hover:border-brand-200"
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-ink">
                      <Icon name={opt.icon} size={16} className="text-brand-600" /> {opt.title}
                    </span>
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2", active ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong")}>
                      {active && <Icon name="check" size={12} strokeWidth={3} />}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">{opt.text}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader icon="scale" title="Thresholds" subtitle="Used by the collateral and document agents" />
          <div className="divide-y divide-line px-5 pb-2">
            {THRESHOLDS.map((t) => {
              const value = draft[t.key];
              const bad = !(value >= t.min && value <= t.max && Number.isInteger(value));
              return (
                <div key={t.key} className="flex items-center justify-between gap-6 py-3.5">
                  <div>
                    <p className="text-sm font-semibold text-ink">{t.label}</p>
                    <p className="text-xs text-ink-muted">
                      {t.hint} · allowed {t.min}–{t.max}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("flex h-10 items-center rounded-xl border bg-surface", bad ? "border-bad" : "border-line-strong")}>
                      <button type="button" aria-label={`Decrease ${t.label}`} onClick={() => setDraft({ ...draft, [t.key]: Math.max(t.min, value - 1) })} className="flex h-full w-9 items-center justify-center text-ink-muted hover:text-brand-600">
                        −
                      </button>
                      <input
                        type="number"
                        min={t.min}
                        max={t.max}
                        step={1}
                        value={Number.isNaN(value) ? "" : value}
                        onChange={(e) => setDraft({ ...draft, [t.key]: e.target.value === "" ? NaN : Number(e.target.value) })}
                        aria-label={t.label}
                        aria-invalid={bad}
                        className="w-14 bg-transparent text-center text-sm font-semibold tabular-nums text-ink outline-none"
                      />
                      <button type="button" aria-label={`Increase ${t.label}`} onClick={() => setDraft({ ...draft, [t.key]: Math.min(t.max, (Number.isNaN(value) ? t.min : value) + 1) })} className="flex h-full w-9 items-center justify-center text-ink-muted hover:text-brand-600">
                        +
                      </button>
                    </div>
                    <span className="w-9 text-xs text-ink-muted">{t.unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <ValuationCard draft={draft} setDraft={setDraft} issues={issues} showAll={attempted} />
        <MeasurementCard draft={draft} setDraft={setDraft} issues={issues} />
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="sticky bottom-5 z-10 mx-auto flex max-w-[816px] items-center justify-between gap-3 rounded-2xl border border-line bg-brand-900 px-5 py-3 text-white shadow-lift"
          >
            <span className="flex items-center gap-2 text-sm">
              <Icon name="info" size={16} className="text-gold-400" />
              {invalid && attempted ? "Fix the highlighted values to save." : "You have unsaved changes."}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="text-white/80 hover:bg-white/10 hover:text-white"
                disabled={saving}
                onClick={() => {
                  setDraft(saved);
                  setAttempted(false);
                }}
              >
                Discard
              </Button>
              <Button variant="gold" icon="check" loading={saving} onClick={save}>
                Save changes
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
