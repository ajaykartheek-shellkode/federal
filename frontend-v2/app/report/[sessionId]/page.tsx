"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReportDocument from "@/components/report/ReportDocument";
import { FederalWordmark } from "@/components/shell/Brand";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import { ApiError, getSession } from "@/lib/api";
import type { SessionView } from "@/lib/types";

/** Standalone, printable verification report — shareable link and clean "Save as PDF". */
export default function ReportPage({ params }: { params: { sessionId: string } }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSession(params.sessionId)
      .then(({ session }) => {
        if (!session.report) setError("The report for this verification hasn't been generated yet.");
        setSession(session);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the report."));
  }, [params.sessionId]);

  return (
    <div id="report-print-root" className="h-screen overflow-y-auto bg-canvas">
      <div className="no-print sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[900px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <FederalWordmark size={19} className="whitespace-nowrap" />
            <span className="h-7 w-px bg-line" />
            <span className="text-sm font-semibold text-ink">Verification report</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/?session=${params.sessionId}`}
              className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink-2 hover:bg-brand-50 hover:text-brand-700"
            >
              <Icon name="arrowRight" size={16} className="rotate-180" /> Open in portal
            </Link>
            <Button variant="gold" icon="download" disabled={!session?.report} onClick={() => window.print()}>
              Download PDF
            </Button>
          </div>
        </div>
      </div>
      <div className="px-6 py-8">
        {error ? (
          <div className="mx-auto flex max-w-lg items-center gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
            <Icon name="info" size={16} /> {error}
          </div>
        ) : session?.report ? (
          <ReportDocument session={session} />
        ) : (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading report…
          </div>
        )}
      </div>
    </div>
  );
}
