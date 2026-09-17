"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Controls";
import { Input } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import { ApiError, fetchAccountReport, fetchDailyReport, fetchOverview, fetchReportDates } from "@/lib/api";
import { cn, formatDate } from "@/lib/format";
import { viewTransition } from "@/lib/motion";
import type { AccountReport, DailyReport, OverviewReport, RunRecord } from "@/lib/types";
import { CategorySplits, OutcomeChart, RunCard, StatTile } from "./ReportParts";

type Mode = "overview" | "date" | "account";

function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    run()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Couldn't load the report."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [run]);
  return { data, error, loading };
}

function Loading() {
  return (
    <div className="flex h-48 items-center justify-center gap-2 text-sm text-ink-muted">
      <Spinner /> Loading…
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-sm text-bad">
      <Icon name="xCircle" size={16} /> {message}
    </div>
  );
}

function RunList({ runs, title }: { runs: RunRecord[]; title: string }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="doc" title="No verifications" hint="Completed verification reports appear here." />
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      )}
    </section>
  );
}

const pct = (n: number) => `${Math.round(n)}%`;

function Overview() {
  const { data, error, loading } = useLoad<OverviewReport>(() => fetchOverview(7), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const { totals } = data;
  const proceedRate = totals.runs ? (totals.pass / totals.runs) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile icon="layers" label="Verifications (7 days)" value={totals.runs} />
        <StatTile icon="shieldCheck" label="Passed cleanly" value={proceedRate} format={pct} hint={`${totals.pass} of ${totals.runs} sessions`} />
        <StatTile icon="alert" label="Needed review" value={totals.alert} />
        <StatTile icon="xCircle" label="Failed checks" value={totals.fail} />
      </div>
      <OutcomeChart days={data.days} />
      <CategorySplits counts={data.counts} />
      <RunList runs={data.runs.slice(0, 20)} title="Recent verifications" />
    </div>
  );
}

function ByDate() {
  const dates = useLoad<string[]>(fetchReportDates, []);
  const [active, setActive] = useState("");
  const current = active || dates.data?.[0] || "";
  const daily = useLoad<DailyReport | null>(() => (current ? fetchDailyReport(current) : Promise.resolve(null)), [current]);

  if (dates.loading && !dates.data) return <Loading />;
  if (dates.error) return <ErrorNote message={dates.error} />;
  if (!dates.data?.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
        <EmptyState icon="calendar" title="No reports yet" hint="Generate a verification report to see it here." />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {dates.data.map((d) => (
          <button
            key={d}
            onClick={() => setActive(d)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              d === current ? "bg-brand-600 text-white shadow-xs" : "border border-line-strong bg-surface text-brand-700 hover:bg-brand-50"
            )}
          >
            {formatDate(d)}
          </button>
        ))}
      </div>
      {daily.error && <ErrorNote message={daily.error} />}
      {daily.loading && !daily.data ? (
        <Loading />
      ) : (
        daily.data && (
          <motion.div key={daily.data.date} {...viewTransition} className="space-y-5">
            <CategorySplits counts={daily.data.counts} />
            <RunList runs={daily.data.runs} title={`${daily.data.run_count} verification${daily.data.run_count === 1 ? "" : "s"} on ${formatDate(daily.data.date)}`} />
          </motion.div>
        )
      )}
    </div>
  );
}

function ByAccount() {
  const [input, setInput] = useState("");
  const [report, setReport] = useState<AccountReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    const account = input.trim();
    if (!account) return;
    setLoading(true);
    setError("");
    try {
      setReport(await fetchAccountReport(account));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the account report.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="relative flex-1">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Loan account number" className="pl-9" aria-label="Loan account number" />
        </div>
        <Button type="submit" icon="search" loading={loading} disabled={!input.trim()}>
          Search
        </Button>
      </form>
      {error && <ErrorNote message={error} />}
      {report && (
        <motion.div key={report.account} {...viewTransition} className="space-y-5">
          <CategorySplits counts={report.counts} />
          <RunList runs={report.runs} title={`${report.run_count} verification${report.run_count === 1 ? "" : "s"} for ${report.account}`} />
        </motion.div>
      )}
    </div>
  );
}

export default function ReportsView() {
  const [mode, setMode] = useState<Mode>("overview");
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] space-y-5 px-8 py-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Reports</h1>
            <p className="text-sm text-ink-muted">Pass, review and failure counts for collateral, damage and documentary proof.</p>
          </div>
          <Segmented
            layoutId="reports-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "overview", label: "Overview" },
              { value: "date", label: "By date" },
              { value: "account", label: "By loan account" },
            ]}
          />
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={mode} {...viewTransition}>
            {mode === "overview" && <Overview />}
            {mode === "date" && <ByDate />}
            {mode === "account" && <ByAccount />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
