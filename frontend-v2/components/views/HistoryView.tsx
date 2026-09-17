"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import { Badge, ResultBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import { ApiError, fetchOpenSessions, fetchOverview, type SessionSummary } from "@/lib/api";
import { formatDateTime, WORKFLOW_STEPS } from "@/lib/format";
import { fadeUp, stagger } from "@/lib/motion";
import type { OverviewReport } from "@/lib/types";
import { StatTile } from "./ReportParts";

export default function HistoryView() {
  const { resume, setView, state, session } = useVerification();
  const [data, setData] = useState<OverviewReport | null>(null);
  const [open, setOpen] = useState<SessionSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchOverview(7)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load history."));
    fetchOpenSessions(12)
      .then(setOpen)
      .catch(() => setOpen([]));
  }, []);

  const openSession = async (sessionId: string) => {
    setView("verify");
    await resume(sessionId);
  };

  const runs = data?.runs ?? [];
  const proceed = runs.filter((r) => r.summary.recommendation === "PROCEED").length;
  const items = runs.reduce((sum, r) => sum + (r.summary.stats?.items ?? 0), 0);
  const damaged = runs.reduce((sum, r) => sum + (r.summary.stats?.damaged ?? 0), 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] space-y-5 px-8 py-7">
        <div>
          <h1 className="text-2xl font-bold text-ink">History</h1>
          <p className="text-sm text-ink-muted">Unfinished verifications and reports from the last 7 days. Open any session to continue or review it.</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-sm text-bad">
            <Icon name="xCircle" size={16} /> {error}
          </div>
        )}

        {!data && !error ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading…
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatTile icon="layers" label="Sessions" value={runs.length} />
              <StatTile icon="shieldCheck" label="Recommended to proceed" value={proceed} hint={runs.length ? `${Math.round((proceed / runs.length) * 100)}% of sessions` : undefined} />
              <StatTile icon="gem" label="Ornaments verified" value={items} />
              <StatTile icon="alert" label="Damage records" value={damaged} />
            </div>

            {open.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-gold-200 bg-surface shadow-card">
                <div className="flex items-center gap-2 border-b border-gold-100 bg-cream px-5 py-3">
                  <Icon name="clock" size={16} className="text-gold-600" />
                  <h2 className="text-sm font-semibold text-ink">In progress</h2>
                  <span className="text-xs text-ink-muted">· unfinished verifications you can pick up again</span>
                </div>
                <ul className="divide-y divide-line">
                  {open.map((o) => {
                    const current = session?.session_id === o.session_id;
                    const step = WORKFLOW_STEPS.find((w) => w.key === o.workflow_state)?.label ?? o.workflow_state;
                    return (
                      <li key={o.session_id} className="flex items-center gap-4 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {o.customer_name} <span className="font-mono text-xs font-normal text-ink-muted">· {o.account_number}</span>
                          </p>
                          <p className="text-xs text-ink-muted">
                            {o.scenario} · at {step.toLowerCase()} · updated {formatDateTime(o.updated_at)}
                          </p>
                        </div>
                        {current ? (
                          <Badge tone="brand">Open now</Badge>
                        ) : (
                          <Button size="sm" variant="secondary" iconRight="arrowRight" disabled={!!state.busy} onClick={() => openSession(o.session_id)}>
                            Resume
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {runs.length === 0 ? (
                <EmptyState icon="history" title="No verifications in the last 7 days" hint="Completed reports will be listed here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-subtle text-left text-2xs font-bold uppercase tracking-wider text-ink-muted">
                        <th className="px-5 py-2.5">Completed</th>
                        <th className="py-2.5 pr-3">Customer</th>
                        <th className="py-2.5 pr-3">Scenario</th>
                        <th className="py-2.5 pr-3">Items</th>
                        <th className="py-2.5 pr-3">Recommendation</th>
                        <th className="py-2.5 pr-3">Result</th>
                        <th className="py-2.5 pr-5" />
                      </tr>
                    </thead>
                    <motion.tbody variants={stagger(0.03)} initial="hidden" animate="show">
                      {runs.map((r) => {
                        const current = session?.session_id === r.session_id;
                        return (
                          <motion.tr key={r.id} variants={fadeUp} className="border-t border-line transition-colors hover:bg-subtle/70">
                            <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-2">{formatDateTime(r.created_at)}</td>
                            <td className="py-3 pr-3">
                              <p className="font-semibold text-ink">{r.loan.customer_name}</p>
                              <p className="font-mono text-2xs text-ink-muted">{r.loan.account_number}</p>
                            </td>
                            <td className="py-3 pr-3 text-xs text-ink-2">{r.loan.scenario}</td>
                            <td className="py-3 pr-3 text-xs tabular-nums text-ink-2">
                              {r.summary.stats ? `${r.summary.stats.items} · ${r.summary.stats.damaged} dmg` : "—"}
                            </td>
                            <td className="py-3 pr-3">
                              {r.summary.recommendation ? (
                                <Badge tone={r.summary.recommendation === "PROCEED" ? "ok" : "gold"}>{r.summary.recommendation}</Badge>
                              ) : (
                                <span className="text-xs text-ink-faint">—</span>
                              )}
                            </td>
                            <td className="py-3 pr-3">
                              <ResultBadge status={r.overall_status} />
                            </td>
                            <td className="py-3 pr-5 text-right">
                              {r.session_id &&
                                (current ? (
                                  <Badge tone="brand">Open now</Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    iconRight="arrowRight"
                                    disabled={!!state.busy}
                                    onClick={() => openSession(r.session_id!)}
                                  >
                                    Open
                                  </Button>
                                ))}
                            </td>
                          </motion.tr>
                        );
                      })}
                    </motion.tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
