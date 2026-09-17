"use client";

import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import { fetchHealth, type Health } from "@/lib/api";
import { cn } from "@/lib/format";
import { FederalWordmark } from "./Brand";
import ShellkodeLogo from "./ShellkodeLogo";

function AiStatus() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetchHealth().then((h) => alive && setHealth(h));
    load();
    const timer = window.setInterval(load, 120_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const state = health === null ? "checking" : health.ok ? "online" : "offline";
  const label = { checking: "Connecting…", online: "AI online", offline: "AI unavailable" }[state];
  const title = health?.ok
    ? `Claude on Amazon Bedrock · ${health.region} · ${health.latencyMs ?? "–"} ms`
    : health?.error ?? "Checking Bedrock connectivity";

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset",
        state === "online" && "bg-ok-soft text-ok ring-ok-line",
        state === "offline" && "bg-bad-soft text-bad ring-bad-line",
        state === "checking" && "bg-subtle text-ink-muted ring-line"
      )}
    >
      <span className="relative flex h-2 w-2">
        {state === "online" && <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-40" />}
        <span className={cn("relative h-2 w-2 rounded-full", state === "online" ? "bg-ok" : state === "offline" ? "bg-bad" : "bg-ink-faint")} />
      </span>
      {label}
    </span>
  );
}

export default function TopBar() {
  const { session, state, openDialog } = useVerification();

  return (
    <header className="relative z-10 flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
      <div className="flex min-w-0 items-center gap-5">
        <FederalWordmark size={21} className="shrink-0 whitespace-nowrap" />
        <span className="h-8 w-px bg-line" />
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[15px] font-bold leading-tight text-ink">GL Portal</div>
          <div className="truncate text-xs text-ink-muted">Gold Loan Collateral Verification</div>
        </div>
        {session && (
          <span className="hidden truncate rounded-full bg-brand-50 px-3 py-1 font-mono text-xs font-semibold text-brand-700 2xl:inline">
            {session.loan.account_number}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {session && (
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={!!state.busy}
            onClick={() => openDialog({ kind: "new-session" })}
          >
            New verification
          </Button>
        )}
        <AiStatus />
        <div className="hidden items-center gap-2 border-l border-line pl-4 lg:flex">
          <span className="text-2xs uppercase tracking-wider text-ink-faint">Powered by</span>
          <ShellkodeLogo className="h-[15px] w-auto text-brand-900" />
        </div>
      </div>
    </header>
  );
}
