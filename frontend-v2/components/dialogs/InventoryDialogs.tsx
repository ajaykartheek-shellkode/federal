"use client";

import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { formatWeight, plural, purityLabel } from "@/lib/format";
import { DropZone, FileChip, validateFile } from "./FilePick";

/** Add an ornament the collateral photo did not show — or that the agent missed. */
export function AddItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, addItem, state } = useVerification();
  const [name, setName] = useState("");
  const [material, setMaterial] = useState("gold");
  const [quantity, setQuantity] = useState("1");
  const [weight, setWeight] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setMaterial("gold");
      setQuantity("1");
      setWeight("");
      setTouched(false);
    }
  }, [open]);

  if (!session) return null;
  const qtyNum = Number(quantity);
  const weightNum = weight.trim() === "" ? 0 : Number(weight);
  const errors = {
    name: name.trim().length < 2 ? "Name the ornament (e.g. Gold Bangle)." : "",
    quantity: !(Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 999) ? "Quantity must be a whole number (1–999)." : "",
    weight: !(weightNum >= 0 && weightNum <= 5000) ? "Weight must be between 0 and 5000 g." : "",
  };
  const valid = !Object.values(errors).some(Boolean);
  const busy = state.busy === "mutate";

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    const ok = await addItem({ name: name.trim(), material, quantity: qtyNum, weight_gm: weightNum });
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon="plus"
      title="Add an ornament"
      subtitle="It joins the pledge list with its own id, and is assayed with the rest"
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={touched && !valid} onClick={submit}>
            Add to the list
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="add-name" required>
            Ornament
          </Label>
          <Input
            id="add-name"
            data-autofocus
            value={name}
            maxLength={120}
            placeholder="e.g. Gold Bangle"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            aria-invalid={touched && !!errors.name}
          />
          {touched && <FieldError>{errors.name}</FieldError>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="add-material">Material</Label>
            <Select id="add-material" value={material} onChange={(e) => setMaterial(e.target.value)}>
              {session.options.materials.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="add-qty">Quantity</Label>
            <Input id="add-qty" type="number" inputMode="numeric" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="add-weight" hint="optional">
              Weight (g)
            </Label>
            <Input id="add-weight" type="number" inputMode="decimal" step="0.001" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
        </div>
        {touched && <FieldError>{errors.quantity || errors.weight}</FieldError>}
        <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700">
          <Icon name="info" size={14} className="mt-px shrink-0" />
          Purity comes from the CaratMeter, so leave it — you can weigh the ornament here or in the table.
        </p>
      </div>
    </Dialog>
  );
}

/** Drop a row the agent detected in error, or an ornament the customer is not pledging. */
export function RemoveItemDialog({ open, refId, onClose }: { open: boolean; refId: string; onClose: () => void }) {
  const { session, removeItem, state } = useVerification();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open, refId]);

  const item = session?.inventory.find((i) => i.id === refId);
  if (!session || !item) return null;
  const busy = state.busy === "mutate";

  const submit = async () => {
    if (await removeItem(item.id, reason.trim())) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon="trash"
      title="Remove from the pledge list"
      subtitle="Recorded in the audit trail"
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" icon="trash" loading={busy} onClick={submit}>
            Remove
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-subtle p-3">
          <Thumb assetId={item.thumb_asset_id} alt={item.name} size={48} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {item.name}
              {item.quantity > 1 && <span className="ml-1 text-xs font-normal text-ink-muted">×{item.quantity}</span>}
            </p>
            <p className="truncate text-xs text-ink-muted">
              {purityLabel(item)} · {item.weight_gm > 0 ? formatWeight(item.weight_gm) : "not weighed"} ·{" "}
              {item.origin === "manual" ? "added by you" : "from the photo"}
            </p>
          </div>
        </div>
        <div>
          <Label htmlFor="remove-reason" hint="optional">
            Reason
          </Label>
          <Textarea
            id="remove-reason"
            data-autofocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The agent picked up the tray, not an ornament"
            className="min-h-[64px]"
          />
        </div>
      </div>
    </Dialog>
  );
}

/** The weighing-machine photo: the total weight of everything on the pan. */
export function ScalePhotoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, runStep, state } = useVerification();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setFile(null);
      setError("");
    }
  }, [open]);

  if (!session) return null;
  const busy = !!state.busy;
  const { weight } = session;

  const close = () => {
    setFile(null);
    setError("");
    onClose();
  };

  const submit = async () => {
    if (!file) return;
    const chosen = file;
    close();
    await runStep("scale_photo", { scale: chosen });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      icon="weighScale"
      title="Weighing-machine photo"
      subtitle={`The total of everything on the pan · ${plural(session.stats.items, "ornament")} listed`}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">
            {busy ? "Wait for the current step to finish" : `Entered so far: ${formatWeight(weight.entered_g)}`}
          </span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon="sparkles" disabled={!file || busy} onClick={submit}>
            Read the display
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 space-y-3">
          <DropZone
            onFiles={([f]) => {
              const problem = validateFile(f, false);
              setError(problem ?? "");
              if (!problem) setFile(f);
            }}
            disabled={!!file}
            title={file ? "Photo selected" : "Drop the machine photo here"}
            hint="JPEG, PNG or WebP · up to 15 MB"
            cameraLabel="Capture"
          />
          <FieldError>{error}</FieldError>
          {file && <FileChip file={file} onRemove={() => setFile(null)} />}
        </div>
        <aside className="rounded-xl bg-cream p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gold-700">
            <Icon name="info" size={14} /> Capture checklist
          </p>
          <ul className="space-y-2">
            {[
              "All the pledged ornaments on the pan, nothing else",
              "The display in frame and in focus — no glare",
              "Wait for the reading to settle before the shot",
              "Can't read it? Type the total on the Weight & purity card",
            ].map((tip) => (
              <li key={tip} className="flex gap-2 text-xs leading-snug text-ink-2">
                <Icon name="check" size={13} className="mt-0.5 shrink-0 text-gold-600" strokeWidth={2.4} />
                {tip}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Dialog>
  );
}
