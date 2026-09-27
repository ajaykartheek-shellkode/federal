"use client";

import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import { previewRewind, type RewindEffects } from "@/lib/api";
import { WORKFLOW_STEPS } from "@/lib/format";
import type { WorkflowState } from "@/lib/types";

/** What the assessor does after going back to each step. */
const REDO: Record<string, string> = {
  collateral: "Upload the collateral photos again to rebuild the pledge list.",
  weight: "Upload the weighing-machine photo again, then fetch the purity.",
  damage: "Record the damaged ornaments again, or continue without any.",
  valuation: "Review the maximum loan amount, then continue.",
  document: "Upload the customer's documentary proof again.",
  report: "Generate the report when you are ready.",
};

/**
 * Going back to a step already passed. The confirmation names exactly what will be discarded —
 * the step's own output and the report — so nothing disappears unannounced.
 */
export default function RewindDialog({ open, target, onClose }: { open: boolean; target: string; onClose: () => void }) {
  const { session, goBackTo, state } = useVerification();
  const [effects, setEffects] = useState<RewindEffects | null>(null);
  const [failed, setFailed] = useState(false);

  const sessionId = session?.session_id;
  useEffect(() => {
    if (!open || !sessionId) return;
    let live = true;
    setEffects(null);
    setFailed(false);
    previewRewind(sessionId, target)
      .then((e) => live && setEffects(e))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, target, sessionId]);

  if (!session) return null;
  const step = WORKFLOW_STEPS.find((s) => s.key === (target as WorkflowState));
  const busy = state.busy === "mutate";

  const submit = async () => {
    if (await goBackTo(target)) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon="refresh"
      title={`Go back to ${step?.label ?? target}`}
      subtitle="You can redo this step — what it produced is discarded"
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Stay here
          </Button>
          <Button variant="primary" icon="refresh" loading={busy} onClick={submit}>
            Go back
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {effects === null && !failed && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner size={14} /> Checking what this affects…
          </p>
        )}
        {failed && (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
            <Icon name="alert" size={14} className="mt-px shrink-0" />
            I couldn&apos;t check what this affects. Going back still discards this step&apos;s work and the report.
          </p>
        )}
        {effects && (
          <>
            {effects.labels.length > 0 ? (
              <div className="rounded-xl border border-warn-line bg-warn-soft/60 px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-warn">
                  <Icon name="alert" size={13} /> This discards
                </p>
                <ul className="mt-1.5 space-y-1">
                  {effects.labels.map((label) => (
                    <li key={label} className="flex items-start gap-2 text-sm text-ink-2">
                      <Icon name="x" size={13} className="mt-1 shrink-0 text-warn" />
                      <span className="first-letter:uppercase">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-ink-2">
                Nothing is discarded — this step has no recorded work yet.
              </p>
            )}
            <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700">
              <Icon name="info" size={14} className="mt-px shrink-0" />
              {REDO[target] ?? "Redo this step when you are ready."} Everything else stays as it is, and the move is
              recorded in the audit trail.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
