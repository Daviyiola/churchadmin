// app/(print)/reports/member-giving/printClient.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type {
  MemberGivingReport,
  MemberGivingSummaryReport,
  MemberGivingDetailedReport,
  MemberGivingMonthlyReport,
  RunMemberGivingBody,
  ErrorResponse,
  PaymentMethod,
  MemberGivingMode,
} from "@/lib/reports/members/types";

function isSummaryReport(r: MemberGivingReport): r is MemberGivingSummaryReport {
  return r.meta.view === "summary";
}

function isDetailedReport(r: MemberGivingReport): r is MemberGivingDetailedReport {
  return r.meta.view === "detailed";
}

function isMonthlyReport(r: MemberGivingReport): r is MemberGivingMonthlyReport {
  return r.meta.view === "monthly";
}



function isPaymentMethod(v: string): v is PaymentMethod {
  return v === "cash" || v === "cheque" || v === "online";
}
function isMode(v: string): v is MemberGivingMode {
  return v === "summary" || v === "detailed" || v === "monthly";
}

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function moneyOrEmpty(n: number) {
  return Math.abs(n) < 0.000001 ? "" : money(n);
}

export default function MemberGivingPrintClient() {
  const sp = useSearchParams();
  const qs = sp.toString();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<MemberGivingReport | null>(null);

  const meta = useMemo(() => {
    const tmp = new URLSearchParams(qs);
    const org = tmp.get("org") ?? "";
    const member_ids = tmp.getAll("member_id");
    const modeRaw = tmp.get("mode") ?? "summary";
    const mode: MemberGivingMode = isMode(modeRaw) ? modeRaw : "summary";
    const start = tmp.get("start") ?? "";
    const end = tmp.get("end") ?? "";

    const category_ids = tmp.getAll("category_id");
    const service_ids = tmp.getAll("service_id");
    const payment_methods = tmp.getAll("method").filter(isPaymentMethod);

    return { org, member_ids, mode, start, end, category_ids, service_ids, payment_methods };
  }, [qs]);

  const filtersLine = useMemo(() => {
    const parts: string[] = [];
    if (meta.service_ids.length) parts.push(`Services: ${meta.service_ids.length}`);
    if (meta.category_ids.length) parts.push(`Categories: ${meta.category_ids.length}`);
    if (meta.payment_methods.length) parts.push(`Methods: ${meta.payment_methods.join(", ")}`);
    return parts.join(" • ");
  }, [meta]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");
        setData(null);

        if (!meta.org) throw new Error("Missing org in URL.");
        if (!meta.member_ids.length) throw new Error("Missing member selection in URL.");
        if (!meta.start || !meta.end) throw new Error("Missing start/end dates in URL.");

        const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw new Error(sessionErr.message);

        const token = sessionRes.session?.access_token;
        if (!token) throw new Error("Not authenticated.");

        const body: RunMemberGivingBody = {
          organization_id: meta.org,
          member_id: meta.mode === "monthly" ? undefined : meta.member_ids[0],
          member_ids: meta.mode === "monthly" ? meta.member_ids : undefined,
          mode: meta.mode,
          start_date: meta.start,
          end_date: meta.end,
          category_ids: meta.category_ids.length ? meta.category_ids : undefined,
          service_ids: meta.service_ids.length ? meta.service_ids : undefined,
          payment_methods: meta.payment_methods.length ? meta.payment_methods : undefined,
        };

        const res = await fetch("/api/reports/member-giving/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        const json: unknown = await res.json();
        if (!res.ok) {
          const e = json as Partial<ErrorResponse>;
          throw new Error(e.error || `Failed to run report (${res.status})`);
        }

        if (!alive) return;
        setData(json as MemberGivingReport);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        if (!alive) return;
        setErr(msg);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [meta]);

  const logoUrl = data?.branding.logo_url ?? null;
  const headerText = data?.branding.header_text ?? "Report";
  const subheaderText = data?.branding.subheader_text ?? "Member giving report";

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar (never printed) */}
      <div className="print-hidden sticky top-0 z-10 border-b bg-white">
        <div className="flex items-center justify-between px-6 py-2">
          <div className="text-sm text-slate-600">Print view</div>
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            type="button"
          >
            Print
          </button>
        </div>
      </div>

      <div className="print-root px-10 py-6 print:px-6 print:py-4">
        {/* Header */}
        <div className="text-center">
          {logoUrl ? (
            <div className="mb-2 flex justify-center">
              <Image
                src={logoUrl}
                alt="Organization logo"
                width={80}
                height={80}
                className="h-20 w-20 object-contain"
                unoptimized
                priority
              />
            </div>
          ) : (
            <div className="mb-2" />
          )}

          <div style={{ fontSize: "22pt", fontWeight: 700 }}>{headerText}</div>
          <div style={{ fontSize: "18pt", fontWeight: 700, marginTop: "6pt" }}>
            {subheaderText}
          </div>

          <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "10pt" }}>
            Time Period: {meta.start} to {meta.end}
          </div>

          {data && !isMonthlyReport(data) ? (
            <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "4pt" }}>
              Member: {data.member.name}
            </div>
          ) : null}
          {data && isMonthlyReport(data) ? (
            <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "4pt" }}>
              Members: {data.members.length} selected
            </div>
          ) : null}

          {filtersLine ? (
            <div style={{ fontSize: "9pt", marginTop: "4pt", color: "#475569" }}>
              {filtersLine}
            </div>
          ) : null}
        </div>

        {/* Content */}
        <div className="mt-6">
          <div className="report-container">
            {loading ? (
              <div style={{ fontSize: "11pt", color: "#475569" }}>Loading report…</div>
            ) : err ? (
              <div style={{ fontSize: "11pt", color: "#b91c1c" }}>{err}</div>
            ) : data ? (
              <ReportBody data={data} />
            ) : (
              <div style={{ fontSize: "11pt", color: "#475569" }}>No data.</div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @page {
          size: ${data && isMonthlyReport(data) ? "landscape" : "portrait"};
        }
        @media print {
          .print-hidden {
            display: none !important;
          }
          .print-root {
            padding: 0 !important;
          }
        }

        /* Prevent the “blow up when printing” issue */
        .report-container {
          width: 100%;
          max-width: 980px; /* keeps it from stretching across whole sheet */
        }

        table.report-table {
          border-collapse: collapse;
          width: auto; /* key: do NOT stretch to 100% */
          table-layout: fixed;
        }
        .th-cell,
        .td-cell {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Page-break helpers */
        .break-page {
          break-after: page;
          page-break-after: always;
        }
        .break-avoid {
          break-inside: avoid;
          page-break-inside: avoid;
        }
      `}</style>
    </div>
  );
}

function ReportBody({ data }: { data: MemberGivingReport }) {
  if (isSummaryReport(data)) return <SummaryTable data={data} />;
  if (isDetailedReport(data)) return <DetailedTable data={data} />;
  if (isMonthlyReport(data)) return <MonthlyTable data={data} />;
  return null;
}


function SummaryTable({ data }: { data: MemberGivingSummaryReport }) {
  const rows = data.summary.rows;

  const CAT_W = 420;
  const AMT_W = 160;

  return (
    <div style={{ fontSize: "11pt" }}>
      <table className="report-table">
        <colgroup>
          <col style={{ width: `${CAT_W}px` }} />
          <col style={{ width: `${AMT_W}px` }} />
        </colgroup>

        <thead>
          <tr>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">Category</th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">Amount</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.category_id}>
              <td className="border border-black px-2 py-1 td-cell" title={r.category_name}>
                {r.category_name}
              </td>
              <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
                {moneyOrEmpty(r.amount)}
              </td>
            </tr>
          ))}

          <tr>
            <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">Grand total</td>
            <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
              {moneyOrEmpty(data.summary.grand_total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DetailedTable({ data }: { data: MemberGivingDetailedReport }) {
  const months = data.detailed.months;

  const DATE_W = 120;   // ~15
  const CAT_W = 320;    // ~30-ish
  const METHOD_W = 120; // ~15
  const AMT_W = 140;    // ~15

  return (
    <div style={{ fontSize: "11pt" }} className="grid gap-6">
      {months.map((m) => (
        <div key={m.label} className="break-avoid">
          <table className="report-table">
            <colgroup>
              <col style={{ width: `${DATE_W}px` }} />
              <col style={{ width: `${CAT_W}px` }} />
              <col style={{ width: `${METHOD_W}px` }} />
              <col style={{ width: `${AMT_W}px` }} />
            </colgroup>

            <thead>
              <tr>
                <th
                  colSpan={4}
                  className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold"
                >
                  {m.label}
                </th>
              </tr>
              <tr>
                <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">Date</th>
                <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">Category</th>
                <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">Method</th>
                <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">Amount</th>
              </tr>
            </thead>

            <tbody>
              {m.rows.map((r, idx) => (
                <tr key={`${r.date}-${r.category_id}-${idx}`}>
                  <td className="border border-black px-2 py-1 td-cell">{r.date}</td>
                  <td className="border border-black px-2 py-1 td-cell" title={r.category_name}>
                    {r.category_name}
                  </td>
                  <td className="border border-black px-2 py-1 text-center td-cell">{r.payment_method}</td>
                  <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
                    {moneyOrEmpty(r.amount)}
                  </td>
                </tr>
              ))}

              <tr>
                <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell" colSpan={3}>
                  {m.label} subtotal
                </td>
                <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
                  {moneyOrEmpty(m.subtotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div>
        <table className="report-table">
          <colgroup>
            <col style={{ width: "560px" }} />
            <col style={{ width: "140px" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">Grand total</td>
              <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
                {moneyOrEmpty(data.detailed.grand_total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyTable({ data }: { data: MemberGivingMonthlyReport }) {
  const categories = data.monthly.categories;

  const table = (
    rows: MemberGivingMonthlyReport["monthly"]["member_totals"],
    categoryTotals: Record<string, number>,
    total: number,
    totalLabel: string,
  ) => (
    <table className="report-table w-full text-[9pt]">
      <thead>
        <tr>
          <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold">
            Member
          </th>
          {categories.map((category) => (
            <th
              key={category.id}
              className="border border-black bg-slate-100 px-2 py-1 text-right font-semibold"
            >
              {category.name}
            </th>
          ))}
          <th className="border border-black bg-slate-100 px-2 py-1 text-right font-semibold">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.member_id}>
            <td className="border border-black px-2 py-1 font-medium">
              {row.member_name}
            </td>
            {categories.map((category) => (
              <td key={category.id} className="border border-black px-2 py-1 text-right">
                {money(row.category_amounts[category.id] ?? 0)}
              </td>
            ))}
            <td className="border border-black px-2 py-1 text-right font-semibold">
              {money(row.total)}
            </td>
          </tr>
        ))}
        <tr>
          <td className="border border-black bg-slate-100 px-2 py-1 font-semibold">
            {totalLabel}
          </td>
          {categories.map((category) => (
            <td key={category.id} className="border border-black bg-slate-100 px-2 py-1 text-right font-semibold">
              {money(categoryTotals[category.id] ?? 0)}
            </td>
          ))}
          <td className="border border-black bg-slate-100 px-2 py-1 text-right font-semibold">
            {money(total)}
          </td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <div className="grid gap-6">
      {data.monthly.months.map((month) => (
        <section key={month.key} className="break-avoid overflow-x-auto">
          <div className="border border-b-0 border-black bg-slate-100 px-2 py-1 text-[10pt] font-semibold">
            {month.label}
            <span className="ml-2 font-normal text-slate-600">
              ({month.covered_start} to {month.covered_end})
            </span>
          </div>
          {table(month.rows, month.category_totals, month.subtotal, `${month.label} total`)}
        </section>
      ))}
      <section className="break-avoid overflow-x-auto">
        <div className="border border-b-0 border-black bg-slate-200 px-2 py-1 text-[10pt] font-semibold">
          Report totals
        </div>
        {table(
          data.monthly.member_totals,
          data.monthly.category_totals,
          data.monthly.grand_total,
          "Grand total",
        )}
      </section>
    </div>
  );
}
