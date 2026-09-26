"use client";

import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError, Input, Label, Textarea } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { formatWeight } from "@/lib/format";

const MIN_REASON = 5;
const MAX_G = 50000;

/** Enter or correct the weighing-scale reading from the collateral photo (audited). */
export default function ScaleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, setScaleReading, openDialog, state } = useVerification();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(session?.weight.scale_g !== null && session?.weight.scale_g !== undefined ? String(session.weight.scale_g) : "");
      setReason("");
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  if (!session) return null;
  const w = session.weight;
  const correcting = w.scale_g !== null;
  const grams = Number(value);
  const errors = {
    value: !(value.trim() && grams > 0 && grams <= MAX_G) ? `Enter the displayed weight in grams (0–${MAX_G.toLocaleString("en-IN")}).` : "",
    same: correcting && Math.abs(grams - (w.scale_g ?? 0)) < 0.0005 ? "The total is unchanged." : "",
    reason: correcting && reason.trim().length < MIN_REASON ? `Give a reason for the correction (at least ${MIN_REASON} characters).` : "",
  };
  const valid = !errors.value && !errors.same && !errors.reason;
  const busy = state.busy === "mutate";

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    if (await setScaleReading(Math.round(grams * 1000) / 1000, reason.trim())) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      icon="weighScale"
      title={correcting ? "Correct the machine total" : "Enter the machine total"}
      subtitle="Read the total off the weighing machine's display"
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={touched && !valid} onClick={submit}>
            Save reading
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Thumb
            assetId={w.scale_asset_id}
            alt="Weighing-machine photo"
            fallback="weighScale"
            rounded="rounded-xl"
            className="aspect-[4/3] w-full"
            onClick={
              w.scale_asset_id
                ? () =>
                    openDialog({
                      kind: "lightbox",
                      src: assetUrl(w.scale_asset_id),
                      title: "Weighing-machine photo",
                      caption: "Zoom in to read the display",
                    })
                : undefined
            }
          />
          <p className="mt-1.5 flex items-center gap-1 text-2xs text-ink-muted">
            <Icon name="zoomIn" size={12} /> {w.scale_asset_id ? "Machine photo · click to zoom" : "No machine photo uploaded yet"}
          </p>
        </div>

        <div className="space-y-4">
          {w.scale_g !== null && (
            <div className="rounded-xl border border-line bg-subtle px-3 py-2 text-xs text-ink-2">
              <p className="text-2xs font-bold uppercase tracking-wider text-ink-muted">Current total</p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-ink">{formatWeight(w.scale_g)}</p>
              <p className="text-ink-muted">
                {w.scale_source === "photo" ? "Read by AI from the machine photo" : "Entered by the assessor"}
                {w.scale_text && <span className="font-mono"> · “{w.scale_text}”</span>}
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="scale-grams" required hint={`Across the pledge list: ${formatWeight(w.entered_g)}`}>
              Machine display
            </Label>
            <div className="relative">
              <Input
                id="scale-grams"
                data-autofocus
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                aria-invalid={touched && (!!errors.value || !!errors.same)}
                className="pr-10 text-lg font-semibold tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-muted">g</span>
            </div>
            {touched && <FieldError>{errors.value || errors.same}</FieldError>}
          </div>
          <div>
            <Label htmlFor="scale-reason" required={correcting} hint={correcting ? undefined : "optional"}>
              {correcting ? "Reason for correction" : "Note"}
            </Label>
            <Textarea
              id="scale-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={correcting ? "e.g. Display glare — re-read at the counter" : "Entered from the weighing-scale display"}
              aria-invalid={touched && !!errors.reason}
              className="min-h-[64px]"
            />
            {touched && <FieldError>{errors.reason}</FieldError>}
          </div>
        </div>
      </div>
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700">
        <Icon name="lock" size={14} className="mt-px shrink-0" />
        Recorded in the audit trail. A new machine photo with a readable display replaces this total.
      </p>
    </Dialog>
  );
}
