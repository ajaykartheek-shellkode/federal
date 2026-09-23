"use client";

import { useEffect, useRef } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Spinner from "@/components/ui/Spinner";
import type { WorkflowState } from "@/lib/types";
import AuditTrail from "./AuditTrail";
import CollateralPhotos from "./CollateralPhotos";
import DocumentsCard from "./DocumentsCard";
import InventoryTable from "./InventoryTable";
import PledgeCard from "./PledgeCard";
import ProgressStepper from "./ProgressStepper";
import ReportSummary from "./ReportSummary";
import SessionHeader from "./SessionHeader";
import WeightPurityCard from "./WeightPurityCard";
import WelcomeHero from "./WelcomeHero";

const FOCUS_CARD: Record<WorkflowState, string> = {
  collateral: "card-collateral",
  weight: "card-weight",
  damage: "card-inventory",
  valuation: "card-pledge",
  document: "card-documents",
  report: "card-documents",
  done: "card-report",
};

export default function VerifyView() {
  const { session, state } = useVerification();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastStep = useRef<string | null>(null);
  const wasRevealed = useRef(false);

  // When the workflow moves on, bring the card for the new step into view.
  useEffect(() => {
    if (!session) {
      lastStep.current = null;
      return;
    }
    const key = `${session.session_id}:${session.workflow_state}`;
    if (lastStep.current && lastStep.current !== key) {
      const target = document.getElementById(FOCUS_CARD[session.workflow_state]);
      const container = scrollRef.current;
      if (target && container) {
        window.setTimeout(() => {
          container.scrollTo({ top: target.offsetTop - 96, behavior: "smooth" });
        }, 250);
      }
    }
    lastStep.current = key;
  }, [session]);

  // Bring the inventory into view the first time it is revealed.
  const revealed = !!session && (state.showItems || session.inventory.length > 0);
  useEffect(() => {
    if (!revealed || wasRevealed.current) return;
    wasRevealed.current = true;
    const container = scrollRef.current;
    window.setTimeout(() => {
      const target = document.getElementById("card-inventory");
      if (target && container) container.scrollTo({ top: target.offsetTop - 96, behavior: "smooth" });
    }, 120);
  }, [revealed]);

  if (!session) {
    wasRevealed.current = false;
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1120px] px-8 py-8">
          {state.busy === "restore" ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-ink-muted">
              <Spinner /> Restoring your verification…
            </div>
          ) : (
            <WelcomeHero />
          )}
        </div>
      </div>
    );
  }

  const showDocuments = session.documents !== null || ["document", "report", "done"].includes(session.workflow_state);
  const weighs = session.steps.includes("weight");
  // The pledge list appears as soon as the photo produces one, or when the assessor asks for it.
  const showItems = state.showItems || session.inventory.length > 0;
  // The pledge amount is its own step, reviewed once damage is recorded.
  const showPledge = weighs && ["valuation", "document", "report", "done"].includes(session.workflow_state);

  return (
    <div ref={scrollRef} className="relative h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-gradient-to-b from-canvas via-canvas/95 to-canvas/0 px-8 pb-3 pt-5">
        <div className="mx-auto max-w-[1120px]">
          <ProgressStepper session={session} />
        </div>
      </div>
      <div className="mx-auto max-w-[1120px] space-y-5 px-8 pb-10 pt-1">
        {session.report && <ReportSummary session={session} />}
        <SessionHeader session={session} />
        <CollateralPhotos session={session} />
        {weighs && <WeightPurityCard session={session} />}
        {showItems && <InventoryTable session={session} />}
        {showPledge && <PledgeCard session={session} />}
        {showDocuments && <DocumentsCard session={session} />}
        {/* The audit trail belongs to the finished verification and the report, not the journey. */}
        {session.workflow_state === "done" && <AuditTrail session={session} />}
      </div>
    </div>
  );
}
