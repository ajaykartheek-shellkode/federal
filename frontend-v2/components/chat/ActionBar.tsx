"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { ease } from "@/lib/motion";

/** Context-aware next actions for the current workflow step. */
export default function ActionBar() {
  const { session, state, runStep, openDialog } = useVerification();
  if (!session) return null;

  // Only buttons that run a step are locked while work is in flight; dialog openers stay steady.
  const busy = !!state.busy;
  const { gate, workflow_state: ws } = session;
  const blocked = !gate.allowed;
  const hasPhotos = session.collateral.images.length > 0;
  const hasDocs = (session.documents?.items.length ?? 0) > 0;

  let primary: ReactNode = null;
  let secondary: ReactNode = null;
  let showGate = false;

  switch (ws) {
    case "collateral":
      primary = (
        <Button variant="gold" icon="camera" onClick={() => openDialog({ kind: "collateral" })}>
          {hasPhotos ? "Add more photos" : "Upload collateral photos"}
        </Button>
      );
      if (hasPhotos) {
        secondary = (
          <Button variant="secondary" icon={blocked ? "lock" : undefined} iconRight={blocked ? undefined : "arrowRight"} disabled={busy || blocked} onClick={() => runStep("continue")}>
            Continue
          </Button>
        );
        showGate = blocked;
      }
      break;
    case "weight": {
      const measured = !!session.measurements;
      primary = measured ? (
        <Button variant="secondary" icon="refresh" disabled={busy} onClick={() => runStep("measure")}>
          Re-measure
        </Button>
      ) : (
        <Button variant="gold" icon="weighScale" disabled={busy} onClick={() => runStep("measure")}>
          Fetch CaratMeter readings
        </Button>
      );
      if (measured) {
        secondary = (
          <Button variant={blocked ? "secondary" : "gold"} icon={blocked ? "lock" : undefined} iconRight={blocked ? undefined : "arrowRight"} disabled={busy || blocked} onClick={() => runStep("continue")}>
            Continue to damage
          </Button>
        );
        showGate = blocked;
      }
      break;
    }
    case "damage": {
      const pending = session.cbs_damage_pending.length;
      primary = (
        <Button variant="gold" icon="alert" onClick={() => openDialog({ kind: "damage" })}>
          Record damage
          {pending > 0 && (
            <span className="ml-0.5 rounded-full bg-brand-900 px-1.5 py-px text-2xs font-bold text-gold-300">{pending}</span>
          )}
        </Button>
      );
      secondary = (
        <Button variant="secondary" icon={blocked ? "lock" : undefined} iconRight={blocked ? undefined : "arrowRight"} disabled={busy || blocked} onClick={() => runStep("continue")}>
          {session.damages.length ? "Continue to documents" : "No damage · continue"}
        </Button>
      );
      showGate = blocked;
      break;
    }
    case "document":
      primary = (
        <Button variant="gold" icon="idCard" onClick={() => openDialog({ kind: "document" })}>
          {hasDocs ? "Re-upload documents" : "Upload documents"}
        </Button>
      );
      if (hasDocs) {
        secondary = (
          <Button variant="secondary" icon={blocked ? "lock" : undefined} iconRight={blocked ? undefined : "arrowRight"} disabled={busy || blocked} onClick={() => runStep("continue")}>
            Continue
          </Button>
        );
        showGate = blocked;
      }
      break;
    case "report":
      primary = (
        <Button variant="gold" icon={blocked ? "lock" : "sparkles"} disabled={busy || blocked} onClick={() => runStep("report")}>
          Generate report
        </Button>
      );
      secondary = (
        <Button variant="secondary" icon="refresh" onClick={() => openDialog({ kind: "document" })}>
          Re-upload documents
        </Button>
      );
      showGate = blocked;
      break;
    case "done":
      primary = (
        <Button variant="gold" icon="doc" onClick={() => openDialog({ kind: "report" })}>
          Open report
        </Button>
      );
      secondary = (
        <Button variant="secondary" icon="plus" onClick={() => openDialog({ kind: "new-session" })}>
          New verification
        </Button>
      );
      break;
  }

  return (
    <div className="border-t border-line bg-surface px-3 pb-2 pt-3">
      {/* Keyed by step: the new actions replace the old ones immediately (never a stale, clickable button). */}
      <motion.div
        key={ws}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease }}
        className="flex flex-wrap gap-2"
      >
        {primary}
        {secondary}
      </motion.div>
      <AnimatePresence>
        {showGate && gate.reasons.length > 0 && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 flex gap-1.5 overflow-hidden text-2xs leading-snug text-warn"
          >
            <Icon name="lock" size={12} className="mt-px shrink-0" />
            <span>{gate.reasons[0]}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
