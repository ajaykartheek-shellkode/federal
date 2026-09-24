"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icon";
import { fadeUp, stagger } from "@/lib/motion";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "camera", title: "Collateral photos", text: "Every ornament in the photo becomes a line on the pledge list, cropped and named" },
  { icon: "weighScale", title: "Weight & purity", text: "You weigh each ornament, the machine photo gives the total, and the CaratMeter assays every piece" },
  { icon: "alert", title: "Damage assessment", text: "Close-ups compared with the recorded damage description" },
  { icon: "idCard", title: "Document verification", text: "OCR and name, ID and address match against the CBS record" },
  { icon: "doc", title: "Report & account", text: "Recommendation, audit trail and e-signatures — and the gold loan account on sanction" },
];

export default function WelcomeHero() {
  const { start, openDialog, state } = useVerification();
  const [account, setAccount] = useState("");

  return (
    <motion.div variants={stagger(0.08)} initial="hidden" animate="show" className="space-y-5">
      <motion.section variants={fadeUp} className="fb-wave relative overflow-hidden rounded-3xl bg-brand-hero px-10 py-10 text-white shadow-raised">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-gold-500/15 blur-3xl" aria-hidden />
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-300">
          <Icon name="sparkles" size={14} /> AI-guided verification
        </p>
        <h1 className="mt-3 max-w-2xl text-[34px] font-bold leading-[1.12] text-white">
          Verify gold loan collateral with <span className="text-gold-400">confidence</span>.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/75">
          Find the customer, and the Verification Agent opens a loan application: the collateral photo builds the pledge
          list, you weigh each ornament, the CaratMeter assays it, and the gold loan account is opened on sanction.
        </p>
        <form
          className="mt-7 flex max-w-lg flex-wrap items-center gap-2 rounded-2xl bg-white/10 p-2 ring-1 ring-white/15 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            if (account.trim()) void start(account);
          }}
        >
          <span className="pl-3 text-white/60">
            <Icon name="search" size={18} />
          </span>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="CIF, mobile or ID number — or an existing loan account"
            aria-label="Customer CIF, mobile, ID number or loan account"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/45"
          />
          <Button type="submit" variant="gold" size="lg" iconRight="arrowRight" loading={state.busy === "start"} disabled={!account.trim() || !!state.busy}>
            Start verification
          </Button>
        </form>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/70">
          Customer not in CBS yet?
          <button
            type="button"
            onClick={() => openDialog({ kind: "new-customer" })}
            disabled={!!state.busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            <Icon name="plus" size={13} /> Open an application for a new customer
          </button>
        </p>
      </motion.section>

      <motion.div variants={stagger(0.07, 0.1)} className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            variants={fadeUp}
            whileHover={{ y: -3 }}
            className="rounded-2xl border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-raised"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="font-mono text-xs font-bold text-gold-600">0{i + 1}</span>
            </div>
            <p className="mt-4 text-[15px] font-semibold text-ink">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{s.text}</p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
