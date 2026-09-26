"use client";

import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { FederalWordmark } from "@/components/shell/Brand";
import ShellkodeLogo from "@/components/shell/ShellkodeLogo";
import Button from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import Icon, { type IconName } from "@/components/ui/Icon";
import { ApiError } from "@/lib/api";
import { fadeUp, stagger } from "@/lib/motion";

const HIGHLIGHTS: { icon: IconName; title: string; text: string }[] = [
  { icon: "camera", title: "The photo builds the pledge list", text: "Every ornament on the tray becomes a line you can name, weigh and correct" },
  { icon: "weighScale", title: "One machine photo, every weight", text: "The agent reads the display and apportions the total across the ornaments" },
  { icon: "cpu", title: "CaratMeter purity per piece", text: "One assay request per application — purity is never taken on trust" },
  { icon: "lock", title: "Audited end to end", text: "Every override carries a justification, and the report is signed at the counter" },
];

export default function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const next = params.get("next") || "/";

  // Already signed in (or just signed in): straight through to the portal.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the GL Portal service. Try again.");
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
      {/* ---------------------------------------------------------------- brand panel */}
      <section className="fb-wave relative hidden flex-col justify-between overflow-hidden bg-brand-hero px-12 py-11 text-white lg:flex">
        <div className="absolute -right-24 -top-32 h-[26rem] w-[26rem] rounded-full bg-gold-500/15 blur-3xl" aria-hidden />
        <div className="absolute -bottom-40 -left-24 h-[24rem] w-[24rem] rounded-full bg-white/[0.07] blur-3xl" aria-hidden />

        <FederalWordmark invert size={26} className="relative w-[190px]" />

        <motion.div variants={stagger(0.08)} initial="hidden" animate="show" className="relative max-w-xl">
          <motion.p variants={fadeUp} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-300">
            <Icon name="sparkles" size={14} /> GL Portal · AI-guided verification
          </motion.p>
          <motion.h1 variants={fadeUp} className="mt-4 text-[38px] font-bold leading-[1.1] text-white">
            Gold loan collateral, verified at the counter.
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-3 max-w-md text-[15px] leading-relaxed text-white/75">
            Find the customer by mobile number and the Verification Agent takes it from there — photo
            to pledge list, machine total to per-ornament weights, assay to sanctioned account.
          </motion.p>

          <motion.ul variants={stagger(0.07, 0.15)} className="mt-9 grid gap-3 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <motion.li
                key={h.title}
                variants={fadeUp}
                className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10 backdrop-blur-sm"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-500/20 text-gold-300">
                  <Icon name={h.icon} size={18} />
                </span>
                <p className="mt-3 text-sm font-semibold text-white">{h.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/65">{h.text}</p>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        <div className="relative flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/45">
          Powered by <ShellkodeLogo className="h-3.5 text-white/70" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- sign-in card */}
      <section className="flex items-center justify-center bg-canvas px-6 py-12">
        <motion.div variants={fadeUp} initial="hidden" animate="show" className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <FederalWordmark size={24} className="w-[170px]" />
          </div>

          <h2 className="text-[26px] font-bold leading-tight text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-muted">Use your branch staff credentials to open the portal.</p>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <div>
              <Label htmlFor="email" required>
                Work email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                maxLength={160}
                placeholder="assessor@federalbank.co.in"
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
                className="h-11"
              />
            </div>

            <div>
              <Label htmlFor="password" required>
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={reveal ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  maxLength={128}
                  placeholder="••••••••"
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-brand-50 hover:text-brand-700"
                >
                  <Icon name={reveal ? "x" : "eye"} size={16} />
                </button>
              </div>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2 rounded-xl bg-bad-soft px-3 py-2.5 text-xs font-medium text-bad"
                role="alert"
              >
                <Icon name="alert" size={14} className="mt-px shrink-0" />
                {error}
              </motion.p>
            )}

            <Button type="submit" variant="primary" size="lg" iconRight="arrowRight" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-2xs text-ink-faint">
            Federal Bank · GL Portal — for authorised branch staff only
          </p>
        </motion.div>
      </section>
    </div>
  );
}
