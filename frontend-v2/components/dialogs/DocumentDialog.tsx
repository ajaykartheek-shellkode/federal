"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError, Label, Select } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import { DropZone, FileChip, validateFile } from "./FilePick";

const MAX_DOCS = 3;

interface DocRow {
  key: string;
  type: string;
  file: File;
}

let seq = 0;

export default function DocumentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, runStep, state } = useVerification();
  const [rows, setRows] = useState<DocRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setRows([]);
      setError("");
    }
  }, [open]);

  if (!session) return null;
  const types = session.options.document_types;
  const replacing = (session.documents?.items.length ?? 0) > 0;

  const add = (files: File[]) => {
    const problems: string[] = [];
    const next = [...rows];
    for (const f of files) {
      const problem = validateFile(f, true);
      if (problem) problems.push(problem);
      else if (next.length < MAX_DOCS) next.push({ key: `doc-${seq++}`, type: next.length === 0 ? "Aadhaar Card" : "PAN Card", file: f });
      else problems.push(`Up to ${MAX_DOCS} documents per upload.`);
    }
    setRows(next);
    setError(problems[0] ?? "");
  };

  const submit = async () => {
    if (!rows.length) return;
    const documents = rows.map((r) => ({ declared_type: r.type, file: r.file }));
    onClose();
    await runStep("document", { documents });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon="idCard"
      title="Documentary proof"
      subtitle={`Cross-verified against the CBS record for ${session.loan.customer_name}`}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">{state.busy ? "Wait for the current step to finish" : `${rows.length}/${MAX_DOCS} documents`}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="sparkles" disabled={!rows.length || !!state.busy} onClick={submit}>
            Verify {rows.length > 1 ? `${rows.length} documents` : "document"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {replacing && (
          <p className="flex items-start gap-2 rounded-xl bg-cream px-3 py-2 text-xs text-gold-700">
            <Icon name="info" size={14} className="mt-px shrink-0" />
            Uploading replaces the documents verified earlier in this session.
          </p>
        )}
        <DropZone
          multiple
          allowPdf
          disabled={rows.length >= MAX_DOCS}
          onFiles={add}
          title={rows.length >= MAX_DOCS ? "Maximum documents selected" : "Drop the ID proof here"}
          hint="Image or PDF (multi-page supported) · up to 15 MB"
          cameraLabel="Scan"
        />
        <FieldError>{error}</FieldError>
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.key}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 12 }}
              className="grid items-end gap-3 rounded-xl border border-line p-3 md:grid-cols-[1fr_220px]"
            >
              <FileChip file={r.file} onRemove={() => setRows((rs) => rs.filter((o) => o.key !== r.key))} />
              <div>
                <Label htmlFor={`${r.key}-type`} required>
                  Document type
                </Label>
                <Select
                  id={`${r.key}-type`}
                  value={r.type}
                  onChange={(e) => setRows((rs) => rs.map((o) => (o.key === r.key ? { ...o, type: e.target.value } : o)))}
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Dialog>
  );
}
