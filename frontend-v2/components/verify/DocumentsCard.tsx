"use client";

import { motion } from "framer-motion";
import { useVerification } from "@/components/providers/VerificationProvider";
import { ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/Controls";
import Icon from "@/components/ui/Icon";
import Thumb from "@/components/ui/Thumb";
import { assetUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { DocumentItem, SessionView } from "@/lib/types";

const maskValue = (value: string) => {
  const chars = value.replace(/\s+/g, "");
  return chars.length > 4 ? `${"•".repeat(Math.min(8, chars.length - 4))}${chars.slice(-4)}` : value;
};

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", ok ? "bg-ok-soft text-ok ring-ok-line" : "bg-warn-soft text-warn ring-warn-line")}>
      <Icon name={ok ? "check" : "alert"} size={11} strokeWidth={2.4} /> {label}
    </span>
  );
}

function MatchRow({ label, found, onFile, ok, children }: { label: string; found: string; onFile: string; ok: boolean; children?: React.ReactNode }) {
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-3 text-xs font-semibold text-ink-muted">{label}</td>
      <td className="py-2 pr-3 text-xs text-ink">{found || <span className="text-ink-faint">Not found</span>}</td>
      <td className="py-2 pr-3 text-xs text-ink-2">{onFile}</td>
      <td className="w-[140px] py-2 text-right">
        {children ?? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-bold", ok ? "text-ok" : "text-warn")}>
            <Icon name={ok ? "checkCircle" : "xCircle"} size={14} /> {ok ? "Match" : "No match"}
          </span>
        )}
      </td>
    </tr>
  );
}

function DocumentBlock({ doc, session }: { doc: DocumentItem; session: SessionView }) {
  const { openDialog } = useVerification();
  const checked = doc.status !== "not_checked";
  const threshold = session.settings.doc_match_threshold_pct;
  const needsOverride = (doc.status === "alert" || doc.status === "fail") && !doc.overridden && session.workflow_state !== "done";
  const addressOk = doc.matches.address_pct >= threshold;

  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }} className="rounded-xl border border-line p-4">
      <div className="flex items-start gap-4">
        <Thumb
          assetId={doc.asset_id}
          alt={doc.declared_type}
          size={88}
          fallback="idCard"
          contentType={doc.content_type}
          onClick={doc.asset_id ? () => openDialog({ kind: "lightbox", src: assetUrl(doc.asset_id), title: doc.declared_type, caption: doc.filename, contentType: doc.content_type }) : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">{doc.declared_type}</p>
              <p className="truncate text-xs text-ink-muted">
                {checked && doc.doc_type_detected ? `Detected: ${doc.doc_type_detected} · ` : ""}
                {doc.filename}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ResultBadge status={doc.status} overridden={doc.overridden} />
              {needsOverride && (
                <Button size="sm" variant="secondary" icon="pen" onClick={() => openDialog({ kind: "override", target: "document", ref: String(doc.doc_no) })}>
                  Override
                </Button>
              )}
            </div>
          </div>
          {checked ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Check ok={doc.legible} label={doc.legible ? "Legible" : "Poor legibility"} />
              <Check ok={doc.complete} label={doc.complete ? "Complete" : "Incomplete"} />
              <Check ok={doc.type_matches_declared} label={doc.type_matches_declared ? "Type matches" : "Type mismatch"} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">Recorded for manual verification — AI validation is off for {session.loan.scenario}.</p>
          )}
          {doc.issues.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {doc.issues.map((issue) => (
                <li key={issue} className="flex items-center gap-1.5 text-xs text-warn">
                  <Icon name="info" size={13} /> {issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {checked && (
        <table className="mt-3 w-full">
          <thead>
            <tr className="text-left text-2xs font-bold uppercase tracking-wider text-ink-faint">
              <th className="pb-1 pr-3 font-bold">Cross-verification</th>
              <th className="pb-1 pr-3 font-bold">On document</th>
              <th className="pb-1 pr-3 font-bold">CBS record</th>
              <th className="pb-1 text-right font-bold">Result</th>
            </tr>
          </thead>
          <tbody>
            <MatchRow label="Name" found={doc.extracted.name} onFile={session.loan.customer_name} ok={doc.matches.name} />
            <MatchRow label="ID number" found={doc.extracted.id_number ? maskValue(doc.extracted.id_number) : ""} onFile={session.loan.id_number_masked || "Not on file"} ok={doc.matches.id} />
            <MatchRow label="Address" found={doc.extracted.address} onFile={session.loan.has_address ? "On file" : "Not on file"} ok={addressOk}>
              <div className="ml-auto w-[130px]">
                <div className="mb-1 flex items-center justify-between text-2xs">
                  <span className={cn("font-bold", addressOk ? "text-ok" : "text-warn")}>{doc.matches.address_pct}%</span>
                  <span className="text-ink-faint">min {threshold}%</span>
                </div>
                <ProgressBar value={doc.matches.address_pct} tone={addressOk ? "ok" : "warn"} />
              </div>
            </MatchRow>
          </tbody>
        </table>
      )}
    </motion.div>
  );
}

export default function DocumentsCard({ session }: { session: SessionView }) {
  const { openDialog } = useVerification();
  const docs = session.documents?.items ?? [];
  const canUpload = session.allowed_actions.includes("document");

  return (
    <Card id="card-documents">
      <CardHeader
        icon="idCard"
        title="Document verification"
        subtitle="Completeness · legibility · OCR · name, ID and address against CBS"
        actions={
          canUpload && docs.length > 0 ? (
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => openDialog({ kind: "document" })}>
              Re-upload
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong">
            <EmptyState icon="idCard" title="No documents yet" hint="Upload the customer's identity proof (e.g. Aadhaar). The agent reads it and cross-verifies the details with CBS." />
            {canUpload && (
              <div className="-mt-3 flex justify-center pb-6">
                <Button variant="gold" icon="idCard" onClick={() => openDialog({ kind: "document" })}>
                  Upload documents
                </Button>
              </div>
            )}
          </div>
        ) : (
          docs.map((doc) => <DocumentBlock key={`${doc.doc_no}-${doc.asset_id}`} doc={doc} session={session} />)
        )}
      </div>
    </Card>
  );
}
