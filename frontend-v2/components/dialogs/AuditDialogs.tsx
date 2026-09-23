"use client";

import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { formatWeight, MEASURE_META, purityLabel } from "@/lib/format";
import type { OverrideTarget } from "@/lib/store";

const MIN_REASON = 5;

function AuditNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700">
      <Icon name="lock" size={14} className="mt-px shrink-0" />
      Recorded permanently in the audit trail with your justification and a timestamp.
    </p>
  );
}

export function OverrideDialog({ open, target, refId, onClose }: { open: boolean; target: OverrideTarget; refId: string; onClose: () => void }) {
  const { session, override, state } = useVerification();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setTouched(false);
    }
  }, [open, refId]);

  if (!session) return null;

  let title = "Override finding";
  let context: React.ReactNode = null;
  if (target === "damage") {
    const d = session.damages.find((x) => x.ornament_id === refId);
    if (d) {
      title = "Accept damage finding";
      context = (
        <Context thumb={d.thumb_asset_id} name={d.item} meta={`${d.type} · ${d.severity} · ${d.damage_percent}%`}>
          <ResultBadge status={d.status} />
          {d.notes && <span className="text-xs text-ink-muted">{d.notes}</span>}
        </Context>
      );
    }
  } else if (target === "measurement") {
    const item = session.inventory.find((i) => i.id === refId);
    const m = item?.measurement;
    title = "Accept CaratMeter reading";
    context = item && (
      <Context thumb={item.thumb_asset_id} name={item.name} meta={`Entered ${formatWeight(item.weight_gm)}`}>
        <span className="text-xs font-semibold text-warn">{MEASURE_META[item.measurement_status ?? "pending"].label}</span>
        {m && (
          <span className="text-xs text-ink-muted">
            Device {formatWeight(m.weight_g)} · {m.fineness_pct.toFixed(2)}% ({m.grade ?? "ungraded"})
          </span>
        )}
      </Context>
    );
  } else if (target === "scale") {
    const w = session.weight;
    title = w.scale_g === null ? "Continue without a machine total" : "Accept the difference";
    context = (
      <Context
        thumb={w.scale_asset_id}
        name="Weighing-machine total"
        meta={w.scale_g !== null ? `Machine ${formatWeight(w.scale_g)} · entered ${formatWeight(w.entered_g)}` : "No total captured"}
      >
        {w.scale_status === "mismatch" && (
          <span className="text-xs text-warn">
            Differs by {formatWeight(Math.abs(w.scale_diff_g ?? 0))} (tolerance ±{formatWeight(w.tolerance_g)})
          </span>
        )}
      </Context>
    );
  } else {
    const doc = session.documents?.items.find((x) => String(x.doc_no) === refId);
    title = "Accept document finding";
    context = doc && (
      <Context thumb={doc.asset_id} contentType={doc.content_type} name={doc.declared_type} meta={doc.filename}>
        <ResultBadge status={doc.status} />
        {doc.issues[0] && <span className="text-xs text-ink-muted">{doc.issues[0]}</span>}
      </Context>
    );
  }

  const tooShort = reason.trim().length < MIN_REASON;
  const submit = async () => {
    setTouched(true);
    if (tooShort) return;
    if (await override(target, refId, reason.trim())) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon="pen"
      title={title}
      subtitle="Mandatory justification"
      dismissable={state.busy !== "mutate"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={state.busy === "mutate"}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" loading={state.busy === "mutate"} disabled={touched && tooShort} onClick={submit}>
            Record override
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {context}
        <div>
          <Label htmlFor="override-reason" required hint={`${reason.trim().length}/500`}>
            Justification
          </Label>
          <Textarea
            id="override-reason"
            data-autofocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Verified physically at the counter with the branch manager"
            aria-invalid={touched && tooShort}
          />
          {touched && tooShort && <FieldError>Please give a justification of at least {MIN_REASON} characters.</FieldError>}
        </div>
        <AuditNotice />
      </div>
    </Dialog>
  );
}

function Context({
  thumb,
  name,
  meta,
  contentType,
  children,
}: {
  thumb: string | null;
  name: string;
  meta: string;
  contentType?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-subtle p-3">
      <Thumb assetId={thumb} alt={name} size={48} contentType={contentType} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        <p className="truncate text-xs text-ink-muted">{meta}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

export function EditItemDialog({ open, refId, onClose }: { open: boolean; refId: string; onClose: () => void }) {
  const { session, editItem, state } = useVerification();
  const item = session?.inventory.find((i) => i.id === refId);
  const [name, setName] = useState("");
  const [carat, setCarat] = useState("");
  const grades = (item && session?.options.grades?.[item.material]) ?? session?.options.carats.map((c) => `${c}K`) ?? [];
  const token = (g: string) => g.toUpperCase().replace(/K$/, "");
  const [weight, setWeight] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open && item) {
      setName(item.name);
      setCarat(item.carat);
      setWeight(String(item.weight_gm));
      setQuantity(String(item.quantity));
      setReason("");
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refId]);

  if (!session || !item) return null;

  const weightNum = Number(weight);
  const qtyNum = Number(quantity);
  const errors = {
    name: name.trim().length < 2 ? "Enter the item name." : "",
    weight: !(weightNum > 0 && weightNum <= 5000) ? "Weight must be between 0 and 5000 g." : "",
    quantity: !(Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 999) ? "Quantity must be a whole number (1–999)." : "",
    reason: reason.trim().length < MIN_REASON ? `Give a reason (at least ${MIN_REASON} characters).` : "",
  };
  const changed =
    name.trim() !== item.name || carat !== item.carat || weightNum !== item.weight_gm || qtyNum !== item.quantity;
  const valid = !Object.values(errors).some(Boolean) && changed;

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    const changes = {
      ...(name.trim() !== item.name && { name: name.trim() }),
      ...(carat !== item.carat && { carat }),
      ...(weightNum !== item.weight_gm && { weight_gm: weightNum }),
      ...(qtyNum !== item.quantity && { quantity: qtyNum }),
    };
    if (await editItem(item.id, changes, reason.trim())) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon="pen"
      title="Correct inventory item"
      subtitle={`CBS record ${item.id}`}
      dismissable={state.busy !== "mutate"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={state.busy === "mutate"}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" loading={state.busy === "mutate"} disabled={touched && !valid} onClick={submit}>
            Save correction
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-name" required>
            Item name
          </Label>
          <Input id="edit-name" data-autofocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !!errors.name} />
          {touched && <FieldError>{errors.name}</FieldError>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="edit-carat" hint="from the assay">
              Purity
            </Label>
            <Select id="edit-carat" value={carat} onChange={(e) => setCarat(e.target.value)}>
              <option value="">Not assayed</option>
              {grades.map((g) => (
                <option key={g} value={token(g)}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-weight">Weight (g)</Label>
            <Input id="edit-weight" type="number" inputMode="decimal" step="0.001" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} aria-invalid={touched && !!errors.weight} />
          </div>
          <div>
            <Label htmlFor="edit-qty">Quantity</Label>
            <Input id="edit-qty" type="number" inputMode="numeric" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={touched && !!errors.quantity} />
          </div>
        </div>
        {touched && <FieldError>{errors.weight || errors.quantity}</FieldError>}
        <div>
          <Label htmlFor="edit-reason" required>
            Reason for correction
          </Label>
          <Textarea id="edit-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Re-weighed at the counter on calibrated scale" aria-invalid={touched && !!errors.reason} />
          {touched && <FieldError>{errors.reason || (!changed ? "Change at least one detail." : "")}</FieldError>}
        </div>
        <AuditNotice />
      </div>
    </Dialog>
  );
}

export function NewSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, reset, state } = useVerification();
  const inProgress = session && session.workflow_state !== "done";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon="plus"
      title="Start a new verification?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep working
          </Button>
          <Button
            variant="primary"
            icon="arrowRight"
            disabled={!!state.busy}
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Start new
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">
        {inProgress
          ? "This verification isn't finished. Everything captured so far is saved — you can reopen it later from History."
          : "The current report is saved and can be reopened from History."}
      </p>
    </Dialog>
  );
}
