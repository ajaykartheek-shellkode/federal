"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import { plural } from "@/lib/format";
import { DropZone, FileChip, validateFile } from "./FilePick";

const MAX_PHOTOS = 3;
const TIPS = [
  "Place all pledged ornaments together on the weighing scale",
  "Keep the scale display readable in the photo — no glare or shadow",
  "Keep every item fully inside the frame — nothing cropped or overlapping",
  "No hands, packaging, documents or other objects in the photo",
  "Use more than one photo if the set is large (up to 3 per upload)",
];

export default function CollateralDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, runStep, state } = useVerification();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");

  const pending = session?.inventory.filter((r) => r.status === "pending").length ?? 0;
  const busy = !!state.busy;

  const add = (incoming: File[]) => {
    const problems = incoming.map((f) => validateFile(f, false)).filter(Boolean) as string[];
    const valid = incoming.filter((f) => !validateFile(f, false));
    const next = [...files, ...valid].slice(0, MAX_PHOTOS);
    if (files.length + valid.length > MAX_PHOTOS) problems.push(`Up to ${MAX_PHOTOS} photos per upload.`);
    setFiles(next);
    setError(problems[0] ?? "");
  };

  const close = () => {
    setFiles([]);
    setError("");
    onClose();
  };

  const submit = async () => {
    if (!files.length) return;
    const selected = files;
    close();
    await runStep("collateral", { collateral: selected });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      icon="camera"
      title="Collateral photos"
      subtitle={
        session
          ? `${plural(pending, "item")} still to be sighted · ${session.loan.customer_name}`
          : undefined
      }
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">{busy ? "Wait for the current step to finish" : `${files.length}/${MAX_PHOTOS} selected`}</span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon="sparkles" disabled={!files.length || busy} onClick={submit}>
            Verify {files.length > 1 ? `${files.length} photos` : "photo"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 space-y-3">
          <DropZone
            multiple
            onFiles={add}
            disabled={files.length >= MAX_PHOTOS}
            title={files.length >= MAX_PHOTOS ? "Maximum photos selected" : "Drop photos here"}
            hint="JPEG, PNG or WebP · up to 15 MB each"
            cameraLabel="Capture"
          />
          <FieldError>{error}</FieldError>
          <AnimatePresence initial={false}>
            {files.map((f, i) => (
              <motion.div key={`${f.name}-${f.lastModified}-${i}`} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 12 }}>
                <FileChip file={f} onRemove={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <aside className="rounded-xl bg-cream p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gold-700">
            <Icon name="info" size={14} /> Capture checklist
          </p>
          <ul className="space-y-2">
            {TIPS.map((tip) => (
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
