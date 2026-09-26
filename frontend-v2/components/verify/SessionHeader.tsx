"use client";

import { motion } from "framer-motion";
import { useVerification } from "@/components/providers/VerificationProvider";
import { AnimatedNumber } from "@/components/ui/Controls";
import Icon, { type IconName } from "@/components/ui/Icon";
import { cn, formatINR, formatNumber } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import type { SessionView } from "@/lib/types";

function Kpi({ icon, label, children, hint, highlight }: { icon: IconName; label: string; children: React.ReactNode; hint?: string; highlight?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl px-4 py-3 ring-1", highlight ? "bg-gold-500/15 ring-gold-400/40" : "bg-white/[0.08] ring-white/10")} title={hint}>
      <p className={cn("flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider", highlight ? "text-gold-300" : "text-white/60")}>
        <Icon name={icon} size={12} /> {label}
      </p>
      <p className="mt-1 truncate text-[22px] font-bold leading-tight text-white">{children}</p>
    </div>
  );
}

export default function SessionHeader({ session }: { session: SessionView }) {
  const { state } = useVerification();
  const { loan, stats } = session;
  const initials = loan.customer_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const weighs = session.steps?.includes("weight");
  // The pledge amount belongs to its own step, so the KPI appears once that step is reached.
  const showPledge = !weighs || ["valuation", "document", "report", "done"].includes(session.workflow_state);

  return (
    <motion.section variants={fadeUp} initial="hidden" animate="show" className="fb-wave relative overflow-hidden rounded-3xl bg-brand-hero p-6 text-white shadow-raised">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gold-500 text-lg font-bold text-brand-900 shadow-gold">
            {initials || <Icon name="user" size={22} />}
          </span>
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-gold-300">CBS customer</p>
            <h2 className="truncate text-2xl font-bold text-white">{loan.customer_name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/70">
              {loan.application_no && (
                <span className="font-mono" title="Loan application reference">
                  Appl {loan.application_no}
                </span>
              )}
              <span className="font-mono" title={loan.account_number ? "Gold loan account" : "Opened once the verification is recommended to proceed"}>
                A/c {loan.account_number || "on sanction"}
              </span>
              <span className="font-mono">CIF {loan.customer_id}</span>
              {loan.branch && <span>Branch {loan.branch}</span>}
              {loan.id_number_masked && <span className="font-mono">ID {loan.id_number_masked}</span>}
              <span className="rounded-full bg-white/10 px-2 py-px font-semibold text-gold-300">{loan.scenario}</span>
            </p>
          </div>
        </div>
      </div>
      <div className={cn("mt-5 grid grid-cols-2 gap-3", showPledge ? "md:grid-cols-5" : "md:grid-cols-4")}>
        <Kpi icon="gem" label="Ornaments" hint={`${stats.pieces} pieces · ${stats.manual} added by hand`}>
          <AnimatedNumber value={stats.items} />
          <span className="ml-1 text-xs font-semibold text-white/55">{stats.pieces !== stats.items ? `${stats.pieces} pcs` : ""}</span>
        </Kpi>
        <Kpi
          icon="weighScale"
          label="Total weight"
          hint={
            session.weight.scale_g !== null
              ? `Weighing machine reads ${formatNumber(session.weight.scale_g)} g`
              : "Sum of the per-ornament weights"
          }
        >
          <AnimatedNumber value={stats.total_weight} format={(n) => formatNumber(n)} />
          <span className="ml-1 text-sm font-semibold text-white/55">g</span>
        </Kpi>
        <Kpi icon="cpu" label="Assayed" hint="Ornaments the CaratMeter has returned a purity for">
          <AnimatedNumber value={stats.measured} />
          <span className="text-sm font-semibold text-white/55">/{stats.items}</span>
        </Kpi>
        <Kpi icon="alert" label="Damaged">
          <AnimatedNumber value={stats.damaged} />
        </Kpi>
        {showPledge && (
        <Kpi
          icon="rupee"
          label={stats.pledge_is_estimate ? "Pledge · provisional" : "Pledge amount"}
          highlight
          hint={
            stats.pledge_is_estimate
              ? "Provisional until every ornament is assayed. Not a sanction amount."
              : "Weight × rate for the assayed purity × LTV, less the damage deduction. Not a sanction amount."
          }
        >
          <AnimatedNumber value={stats.pledge_amount} format={(n) => formatINR(n)} />
        </Kpi>
        )}
      </div>
    </motion.section>
  );
}
