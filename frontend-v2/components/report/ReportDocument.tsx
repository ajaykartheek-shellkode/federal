"use client";

import type { ReactNode } from "react";
import { FederalWordmark } from "@/components/shell/Brand";
import ShellkodeLogo from "@/components/shell/ShellkodeLogo";
import { assetUrl } from "@/lib/api";
import { CHECK_LABELS, cn, formatDateTime, formatINR, formatNumber, formatWeight, formatWeightDelta, ITEM_META, MEASURE_META, purityLabel, RESULT_META } from "@/lib/format";
import type { ResultStatus, SessionView } from "@/lib/types";
import SignaturePad, { type SignatureState } from "./SignaturePad";

const PILL: Record<string, string> = {
  ok: "bg-[#E6F5EE] text-[#0E9258]",
  warn: "bg-[#FFF3E0] text-[#C26A00]",
  bad: "bg-[#FDEDEC] text-[#D0342C]",
  brand: "bg-[#EEF4FB] text-[#004E96]",
  neutral: "bg-[#F3F6FA] text-[#58647A]",
  gold: "bg-[#FFF1D6] text-[#B26E00]",
};

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", PILL[tone])}>{children}</span>;
}

function Result({ status, overridden }: { status: ResultStatus; overridden?: boolean }) {
  if (overridden) return <Pill tone="brand">Overridden</Pill>;
  const meta = RESULT_META[status];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="report-avoid-break mt-6">
      <h3 className="mb-2.5 flex items-center gap-2 border-b border-[#E3E8F0] pb-1.5 text-[12px] font-bold uppercase tracking-wider text-[#004E96]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#004E96] text-[10px] text-white">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="w-28 shrink-0 text-[#58647A]">{k}</span>
      <span className={cn("font-semibold text-[#15223A]", mono && "font-mono text-[11.5px]")}>{v || "—"}</span>
    </div>
  );
}

const th = "border-b border-[#E3E8F0] px-2 py-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#58647A]";
const td = "border-b border-[#F0F3F8] px-2 py-1.5 align-middle text-[11.5px] text-[#15223A]";

export type SignatureRole = "customer" | "assessor" | "officer";

export default function ReportDocument({
  session,
  onSign,
}: {
  session: SessionView;
  /** Lifts each signature to the viewer, which submits once the customer has signed. */
  onSign?: (role: SignatureRole, signature: SignatureState | null) => void;
}) {
  const report = session.report!;
  const { loan, stats } = session;
  const proceed = report.recommendation === "PROCEED";
  const docs = session.documents?.items ?? [];
  const overrides = session.audit;
  // Prefer what was frozen into the report; fall back to the live session view.
  const valuation = report.valuation ?? session.valuation;
  const weight = report.weight ?? (session.steps?.includes("weight") ? session.weight : null);
  const maxLoan = valuation?.totals.max_loan_amount ?? stats.max_loan_amount ?? stats.pledge_amount;
  let sectionNo = 0;
  const next = () => ++sectionNo;

  return (
    <article className="report-page mx-auto w-[210mm] min-h-[297mm] bg-white px-[15mm] py-[14mm] text-[#35404F] shadow-lift">
      {/* Letterhead */}
      <header className="flex items-start justify-between border-b-[3px] border-[#004E96] pb-4">
        <div>
          <FederalWordmark size={26} />
          <p className="mt-2 text-[18px] font-bold leading-tight text-[#15223A]">Gold Loan Collateral Verification Report</p>
          <p className="text-[11px] text-[#58647A]">AI-assisted validation · GL Portal</p>
        </div>
        <div className="text-right text-[11px] leading-relaxed text-[#58647A]">
          <p className="font-mono text-[12px] font-bold text-[#15223A]">{report.report_id}</p>
          <p>{formatDateTime(report.generated_at)}</p>
          <p>Branch {loan.branch || "—"}</p>
        </div>
      </header>

      {/* Verdict */}
      <div
        className={cn(
          "report-avoid-break mt-5 flex items-center justify-between rounded-xl border-l-[5px] px-5 py-4",
          proceed ? "border-[#0E9258] bg-[#E6F5EE]" : "border-[#FAA619] bg-[#FFF6E7]"
        )}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#58647A]">Recommendation</p>
          <p className={cn("text-[26px] font-bold leading-none", proceed ? "text-[#0E9258]" : "text-[#B26E00]")}>{report.recommendation}</p>
          <p className="mt-1 text-[11px]">{proceed ? "All checks satisfied." : `${report.reasons.filter((r) => r.level === "warn").length} point(s) for the approving officer.`}</p>
        </div>
        <div className="flex gap-6 text-center">
          {[
            [String(stats.items), "Items"],
            [formatWeight(stats.total_weight), "Total weight"],
            [`${stats.measured}/${stats.items}`, "Assayed"],
            [formatINR(maxLoan), "Max loan amount"],
          ].map(([v, l]) => (
            <div key={l}>
              <p className="text-[18px] font-bold text-[#15223A]">{v}</p>
              <p className="text-[9.5px] uppercase tracking-wider text-[#58647A]">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {report.reasons.length > 0 && (
        <ul className="report-avoid-break mt-3 space-y-1">
          {report.reasons.map((r, i) => (
            <li key={i} className="flex gap-2 text-[11.5px]">
              <span className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", r.level === "warn" ? "bg-[#C26A00]" : "bg-[#004E96]")} />
              {r.text}
            </li>
          ))}
        </ul>
      )}

      <Section n={next()} title="Customer & loan">
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          <KV k="Customer" v={loan.customer_name} />
          <KV
            k={loan.application_no ? "Application" : "Loan account"}
            v={loan.application_no || loan.account_number}
            mono
          />
          <KV k="Customer ID" v={loan.customer_id} mono />
          <KV k="Scenario" v={loan.scenario} />
          <KV k="Branch" v={loan.branch} />
          {loan.application_no ? (
            <KV k="Gold loan a/c" v={loan.account_number || "Opened on approval"} mono />
          ) : (
            <KV k="AI validation" v={session.ai_enabled ? "Enabled" : "Disabled (manual)"} />
          )}
          <KV k="Max loan amount" v={formatINR(maxLoan)} />
          <KV k="Mode" v={session.settings.blocker_mode ? "Blocker" : "Alert"} />
          {loan.application_no && <KV k="AI validation" v={session.ai_enabled ? "Enabled" : "Disabled (manual)"} />}
        </div>
      </Section>

      <Section n={next()} title="Collateral verification">
        {session.collateral.images.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-3">
            {session.collateral.images.map((im) => (
              <div key={im.index} className="w-[110px]">
                <div className="h-[80px] w-[110px] overflow-hidden rounded-lg border border-[#E3E8F0] bg-[#F7F9FC]">
                  {im.asset_id && <img src={assetUrl(im.asset_id)} alt={`Collateral photo ${im.index + 1}`} className="h-full w-full object-cover" />}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] text-[#58647A]">Photo {im.index + 1}</span>
                  <Result status={im.status} />
                </div>
                {im.issues[0] && <p className="mt-0.5 text-[9.5px] leading-tight text-[#C26A00]">{im.issues[0]}</p>}
              </div>
            ))}
            {session.ai_enabled && session.collateral.images[0]?.checks && (
              <div className="ml-auto grid grid-cols-2 gap-x-4 gap-y-1 self-start text-[10.5px]">
                {Object.entries(CHECK_LABELS).map(([key, label]) => {
                  const ok = session.collateral.images.every((im) => im.status === "not_checked" || im.checks[key as keyof typeof im.checks]);
                  return (
                    <span key={key} className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-[#0E9258]" : "bg-[#C26A00]")} />
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th} />
              <th className={th}>Ornament</th>
              <th className={th}>Purity</th>
              <th className={th}>Weight</th>
              <th className={th}>Qty</th>
              <th className={th}>Listed</th>
              <th className={th}>Damage</th>
            </tr>
          </thead>
          <tbody>
            {session.inventory.map((it) => {
              const dmg = session.damages.find((d) => d.ornament_id === it.id);
              return (
                <tr key={it.id}>
                  <td className={cn(td, "w-9")}>
                    <div className="h-7 w-7 overflow-hidden rounded-md border border-[#E3E8F0] bg-[#F7F9FC]">
                      {it.thumb_asset_id && <img src={assetUrl(it.thumb_asset_id)} alt="" className="h-full w-full object-cover" />}
                    </div>
                  </td>
                  <td className={cn(td, "font-semibold")}>{it.name}</td>
                  <td className={td}>{purityLabel(it)}</td>
                  <td className={td}>{formatWeight(it.weight_gm)}</td>
                  <td className={td}>{it.quantity}</td>
                  <td className={td}>
                    <Pill tone={ITEM_META[it.origin ?? "detected"].tone}>{ITEM_META[it.origin ?? "detected"].label}</Pill>
                  </td>
                  <td className={td}>
                    {dmg ? (
                      <span className="flex items-center gap-1.5">
                        <Result status={dmg.status} overridden={dmg.overridden} />
                        {!dmg.asset_id && <span className="text-[10px] text-[#58647A]">no photo</span>}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {weight && valuation && (
        <Section n={next()} title="Weight, purity & loan valuation">
          <div className="mb-3 grid grid-cols-3 gap-3">
            {[
              ["Entered per item", formatWeight(weight.entered_g), `${stats.items} ornaments`],
              ["Weighing machine", weight.scale_g !== null ? formatWeight(weight.scale_g) : "Not captured", weight.scale_source === "photo" ? "Read from the machine photo" : weight.scale_source === "assessor" ? "Entered by assessor" : "—"],
              ["Karatometer", weight.measured_g !== null ? formatWeight(weight.measured_g) : "Not assayed", weight.device?.device_id ? `${weight.device.model ?? "Karatometer"} · ${weight.device.device_id}` : "—"],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-lg border border-[#E3E8F0] px-3 py-2">
                <p className="text-[9.5px] font-bold uppercase tracking-wider text-[#58647A]">{k}</p>
                <p className="text-[15px] font-bold text-[#15223A]">{v}</p>
                <p className="text-[10px] text-[#58647A]">{sub}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 text-[11px]">
            Reconciliation:{" "}
            <span className="font-semibold text-[#15223A]">
              {weight.scale_status === "match"
                ? `the machine agrees with the per-ornament weights (±${formatWeight(weight.tolerance_g)})`
                : weight.scale_status === "mismatch"
                  ? `the machine differs from the per-ornament weights by ${formatWeight(Math.abs(weight.scale_diff_g ?? 0))} (tolerance ±${formatWeight(weight.tolerance_g)})`
                  : "no weighing-machine total captured"}
              {weight.scale_overridden && " — accepted by assessor"}
            </span>
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Ornament</th>
                <th className={cn(th, "text-right")}>Gross weight</th>
                <th className={cn(th, "text-right")}>Net weight</th>
                <th className={th}>Purity</th>
                <th className={th}>Δ wt</th>
                <th className={th}>Reading</th>
              </tr>
            </thead>
            <tbody>
              {session.inventory.map((it) => {
                const v = valuation.items.find((x) => x.ornament_id === it.id);
                const m = it.measurement;
                const status = it.measurement_status ?? "pending";
                return (
                  <tr key={it.id}>
                    <td className={cn(td, "font-semibold")}>{it.name}</td>
                    <td className={cn(td, "text-right")}>{formatWeight(it.weight_gm)}</td>
                    <td className={cn(td, "text-right font-semibold")}>{v ? formatWeight(v.net_weight_g) : "—"}</td>
                    <td className={td}>{m ? `${m.grade ?? "Ungraded"} (${m.fineness_pct.toFixed(2)}%)` : purityLabel(it)}</td>
                    <td className={cn(td, "whitespace-nowrap")}>{m ? formatWeightDelta(m.weight_g - it.weight_gm) : "—"}</td>
                    <td className={td}>
                      {it.measurement_overridden ? <Pill tone="brand">Accepted</Pill> : <Pill tone={MEASURE_META[status].tone}>{MEASURE_META[status].label}</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="report-avoid-break mt-2.5 flex items-end justify-between gap-6">
            <p className="max-w-[95mm] text-[10px] leading-snug text-[#58647A]">
              The maximum loan is the net weight — gross weight less {formatNumber(valuation.totals.wastage_pct)}% wastage — at {formatINR(valuation.totals.rate_per_gram)} per gram, as configured when this verification started.{valuation.totals.is_estimate ? " Some ornaments are not assayed yet, so the purity column is provisional." : ""} Indicative — not a sanction.
            </p>
            <div className="min-w-[64mm] text-[11.5px]">
              {[
                ["Gross weight", formatWeight(valuation.totals.gross_weight_g)],
                [`Less wastage (${formatNumber(valuation.totals.wastage_pct)}%)`, `−${formatWeight(valuation.totals.wastage_g)}`],
                ["Net weight", formatWeight(valuation.totals.net_weight_g)],
                ["Rate per gram", formatINR(valuation.totals.rate_per_gram)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-[#58647A]">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between gap-4 border-t border-[#E3E8F0] pt-1 text-[13px] font-bold text-[#004E96]">
                <span>Max loan amount</span>
                <span>{formatINR(valuation.totals.max_loan_amount)}</span>
              </div>
            </div>
          </div>
        </Section>
      )}

      {session.damages.length > 0 && (
        <Section n={next()} title="Damage assessment">
          <div className="space-y-2">
            {session.damages.map((d) => (
              <div key={d.ornament_id} className="report-avoid-break flex gap-3 rounded-lg border border-[#E3E8F0] p-2.5">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[#E3E8F0] bg-[#F7F9FC]">
                  {d.thumb_asset_id && <img src={assetUrl(d.thumb_asset_id)} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1 text-[11.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[#15223A]">
                      {d.item} · {d.type} <span className="font-normal capitalize text-[#58647A]">(assessor: {d.severity})</span>
                    </p>
                    <Result status={d.status} overridden={d.overridden} />
                  </div>
                  {d.assessor_details && <p>Recorded: {d.assessor_details}</p>}
                  {d.observed.length > 0 && <p>AI observed: {d.observed.join("; ")}{d.assessed_severity && d.assessed_severity !== "none" ? ` · ${d.assessed_severity}` : ""}</p>}
                  {d.notes && <p className="text-[#58647A]">{d.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section n={next()} title="Document verification">
        {docs.length === 0 ? (
          <p className="text-[11.5px]">No documents uploaded.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Document</th>
                <th className={th}>Detected</th>
                <th className={th}>Legible</th>
                <th className={th}>Name</th>
                <th className={th}>ID number</th>
                <th className={th}>Address</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const checked = d.status !== "not_checked";
                return (
                  <tr key={d.doc_no}>
                    <td className={cn(td, "font-semibold")}>{d.declared_type}</td>
                    <td className={td}>{checked ? d.doc_type_detected || "—" : "—"}</td>
                    <td className={td}>{checked ? (d.legible ? "Yes" : "No") : "—"}</td>
                    <td className={td}>{checked ? (d.matches.name ? "Match" : "No match") : "—"}</td>
                    <td className={td}>{checked ? (d.matches.id ? "Match" : "No match") : "—"}</td>
                    <td className={td}>{checked ? `${d.matches.address_pct}%` : "—"}</td>
                    <td className={td}>
                      <Result status={d.status} overridden={d.overridden} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {overrides.length > 0 && (
        <Section n={next()} title="Override & correction audit trail">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Item</th>
                <th className={th}>Change</th>
                <th className={th}>Justification</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id}>
                  <td className={cn(td, "whitespace-nowrap text-[10.5px]")}>{formatDateTime(o.ts)}</td>
                  <td className={cn(td, "font-semibold")}>{o.item}</td>
                  <td className={cn(td, "text-[10.5px]")}>
                    {o.original} → {o.new_value}
                  </td>
                  <td className={td}>{o.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <section className="report-avoid-break mt-7">
        <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-[#004E96]">Declaration & authorisation</h3>
        <p className="mb-3 text-[11px] leading-relaxed">
          The customer confirms that the ornaments listed above are pledged by them and that the weights and purity recorded are as
          assessed in their presence. AI validation is advisory; the final assessment and this authorisation are made by the branch
          officials named below.
        </p>
        <div className="flex flex-wrap gap-4">
          <SignaturePad
            role="Customer"
            name={loan.customer_name}
            detail={loan.customer_name}
            onChange={(s) => onSign?.("customer", s)}
          />
          <SignaturePad role="Branch assessor" detail={`Branch ${loan.branch || "—"}`} onChange={(s) => onSign?.("assessor", s)} />
          <SignaturePad
            role="Authorising officer"
            detail={loan.account_number ? `Account ${loan.account_number}` : `Application ${loan.application_no}`}
            onChange={(s) => onSign?.("officer", s)}
          />
        </div>
        {report.submitted_at && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-[#E6F5EE] px-3 py-2 text-[11px] font-semibold text-[#0E9258]">
            Submitted {formatDateTime(report.submitted_at)}
            {report.signatures?.length ? ` · signed by ${report.signatures.map((s) => s.role).join(", ")}` : ""}
          </p>
        )}
      </section>

      <footer className="mt-8 flex items-center justify-between border-t border-[#E3E8F0] pt-3 text-[9.5px] text-[#7C879A]">
        <span>Federal Bank · GL Portal · AI-assisted validation on Amazon Bedrock · Advisory only</span>
        <span className="flex items-center gap-1.5">
          Powered by <ShellkodeLogo className="h-[10px] w-auto text-[#58647A]" />
        </span>
      </footer>
    </article>
  );
}
