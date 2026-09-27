"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError, Input, Label, Select } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import { cn, purityLabel } from "@/lib/format";
import type { DamageEntry, InventoryItem, SessionView, Severity } from "@/lib/types";
import { DropZone, FileChip, validateFile } from "./FilePick";

interface Row {
  key: string;
  ornamentId: string;
  type: string;
  severity: Severity;
  details: string;
  /** Optional: damage is recorded on the assessor's word, and a close-up is evidence when there is one. */
  file: File | null;
}

const guessType = (text: string) => {
  const t = text.toLowerCase();
  if (t.includes("stone")) return "Missing stone";
  if (t.includes("clasp")) return "Broken clasp";
  if (t.includes("crack")) return "Crack";
  if (t.includes("scratch")) return "Scratch";
  if (t.includes("bent") || t.includes("bend")) return "Bent";
  if (t.includes("dent")) return "Dent";
  return "Other";
};

let rowSeq = 0;
function rowFor(item?: InventoryItem, existing?: DamageEntry): Row {
  return {
    key: `row-${rowSeq++}`,
    ornamentId: item?.id ?? "",
    type: existing?.type ?? (existing?.assessor_details ? guessType(existing.assessor_details) : "Dent"),
    severity: existing?.severity ?? "moderate",
    details: existing?.assessor_details ?? "",
    file: null,
  };
}

function initialRows(session: SessionView, ornamentId?: string): Row[] {
  const item = ornamentId ? session.inventory.find((i) => i.id === ornamentId) : undefined;
  const existing = item ? session.damages.find((d) => d.ornament_id === item.id) : undefined;
  return [rowFor(item, existing)];
}

export default function DamageDialog({ open, ornamentId, onClose }: { open: boolean; ornamentId?: string; onClose: () => void }) {
  const { session, runStep, state } = useVerification();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open && session) {
      setRows(initialRows(session, ornamentId));
      setError("");
      setTouched(false);
    }
    // Initialise only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ornamentId]);

  const recorded = useMemo(() => new Set(session?.damages.map((d) => d.ornament_id)), [session?.damages]);
  if (!session) return null;
  const { options, inventory } = session;

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const problems = rows.map((r) => {
    if (!r.ornamentId) return "Choose the damaged ornament.";
    if (r.type === "Other" && !r.details.trim()) return "Describe the damage.";
    return "";
  });
  const valid = rows.length > 0 && problems.every((p) => !p);

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    const payload = rows.map((r) => ({
      ornament_id: r.ornamentId,
      type: r.type,
      severity: r.severity,
      details: r.details.trim(),
      file: r.file,
    }));
    onClose();
    await runStep("damage", { damage: payload });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon="alert"
      title="Record damaged ornaments"
      subtitle="Noted on the report for the approving officer — a close-up helps, but is not required."
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">
            {state.busy
              ? "Wait for the current step to finish"
              : `${rows.length} item${rows.length === 1 ? "" : "s"} · photos are checked in parallel`}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" disabled={!!state.busy || (touched && !valid)} onClick={submit}>
            Record {rows.length > 1 ? `${rows.length} items` : "damage"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {rows.map((r, idx) => {
            const chosenElsewhere = new Set(rows.filter((o) => o.key !== r.key).map((o) => o.ornamentId));
            const item = inventory.find((i) => i.id === r.ornamentId);
            return (
              <motion.div
                key={r.key}
                layout="position"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="overflow-hidden rounded-xl border border-line bg-surface"
              >
                <div className="flex items-center justify-between border-b border-line bg-subtle px-4 py-2">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-700">
                    Item {idx + 1}
                    {item && recorded.has(item.id) && <Badge tone="neutral">Replaces earlier record</Badge>}
                  </span>
                  {rows.length > 1 && (
                    <button onClick={() => setRows((rs) => rs.filter((o) => o.key !== r.key))} className="flex items-center gap-1 text-xs text-ink-muted hover:text-bad">
                      <Icon name="trash" size={13} /> Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor={`${r.key}-orn`} required>
                      Ornament
                    </Label>
                    <Select id={`${r.key}-orn`} value={r.ornamentId} onChange={(e) => update(r.key, { ornamentId: e.target.value })}>
                      <option value="" disabled>
                        Select an ornament…
                      </option>
                      {inventory.map((o) => (
                        <option key={o.id} value={o.id} disabled={chosenElsewhere.has(o.id)}>
                          {o.name} · {purityLabel(o)} · {o.weight_gm > 0 ? `${o.weight_gm} g` : "not weighed"}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`${r.key}-type`} required>
                      Damage type
                    </Label>
                    <Select id={`${r.key}-type`} value={r.type} onChange={(e) => update(r.key, { type: e.target.value })}>
                      {options.damage_types.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Severity (assessor)</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {options.severities.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => update(r.key, { severity: s })}
                          className={cn(
                            "h-10 rounded-xl border text-xs font-semibold capitalize transition-colors",
                            r.severity === s ? "border-brand-500 bg-brand-50 text-brand-700 shadow-focus" : "border-line-strong text-ink-2 hover:border-brand-300"
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor={`${r.key}-details`} hint={r.type === "Other" ? "required" : "optional"}>
                      Description
                    </Label>
                    <Input
                      id={`${r.key}-details`}
                      value={r.details}
                      maxLength={300}
                      onChange={(e) => update(r.key, { details: e.target.value })}
                      placeholder="e.g. Dent on the inner rim near the clasp"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label hint="optional — evidence for the approving officer">Damage photo</Label>
                    {r.file ? (
                      <FileChip file={r.file} onRemove={() => update(r.key, { file: null })} />
                    ) : (
                      <DropZone
                        compact
                        title="Close-up of the damaged area"
                        hint="Fill the frame with the damage"
                        onFiles={([f]) => {
                          const problem = validateFile(f, false);
                          setError(problem ?? "");
                          if (!problem) update(r.key, { file: f });
                        }}
                      />
                    )}
                  </div>
                  {touched && problems[idx] && (
                    <div className="md:col-span-2">
                      <FieldError>{problems[idx]}</FieldError>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <FieldError>{error}</FieldError>
        <button
          type="button"
          disabled={rows.length >= Math.min(10, inventory.length)}
          onClick={() => setRows((rs) => [...rs, rowFor()])}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line-strong py-2.5 text-sm font-semibold text-brand-600 transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
        >
          <Icon name="plus" size={16} /> Add another damaged item
        </button>
      </div>
    </Dialog>
  );
}
