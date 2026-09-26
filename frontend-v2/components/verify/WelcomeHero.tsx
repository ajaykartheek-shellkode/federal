"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icon";
import { fetchCustomers, type SampleAccount } from "@/lib/api";
import { fadeUp, stagger } from "@/lib/motion";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "camera", title: "Collateral photos", text: "Every ornament in the photo becomes a line on the pledge list, cropped and named" },
  { icon: "weighScale", title: "Weight & purity", text: "The machine photo gives the total, I split it across the ornaments, and the CaratMeter assays every piece" },
  { icon: "alert", title: "Damage assessment", text: "Close-ups compared with the recorded damage description" },
  { icon: "idCard", title: "Document verification", text: "OCR and name, ID and address match against the CBS record" },
  { icon: "doc", title: "Report & account", text: "Recommendation, audit trail and e-signatures — and the gold loan account on sanction" },
];

/** Digits only, grouped as the assessor types: 98200 41234. */
const formatMobile = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
};

export default function WelcomeHero() {
  const { start, state } = useVerification();
  const [mobile, setMobile] = useState("");
  const [customers, setCustomers] = useState<SampleAccount[]>([]);

  useEffect(() => {
    void fetchCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  const digits = mobile.replace(/\D/g, "");
  const ready = digits.length === 10 && !state.busy;

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
          Enter the customer&apos;s mobile number and the Verification Agent opens a loan application: the
          collateral photo builds the pledge list, the weighing machine gives every ornament its weight, the
          CaratMeter assays it, and the gold loan account is opened on sanction.
        </p>
        <form
          className="mt-7 flex max-w-lg flex-wrap items-center gap-2 rounded-2xl bg-white/10 p-2 ring-1 ring-white/15 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void start(digits);
          }}
        >
          <span className="pl-3 font-semibold text-white/55">+91</span>
          <input
            value={mobile}
            onChange={(e) => setMobile(formatMobile(e.target.value))}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="98200 41234"
            aria-label="Customer mobile number"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] tracking-wide text-white outline-none placeholder:text-white/40"
          />
          <Button type="submit" variant="gold" size="lg" iconRight="arrowRight" loading={state.busy === "start"} disabled={!ready}>
            Start verification
          </Button>
        </form>

        {customers.length > 0 && (
          <div className="mt-4">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-white/45">Customers in CBS</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {customers.map((c) => (
                <button
                  key={c.account_number}
                  type="button"
                  disabled={!!state.busy}
                  onClick={() => setMobile(formatMobile(c.mobile ?? ""))}
                  title={`${c.scenario} · ${c.branch ?? ""}`}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/90 ring-1 ring-white/15 transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  <span className="font-mono">{c.mobile}</span>
                  <span className="font-normal text-white/60">· {c.customer_name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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
