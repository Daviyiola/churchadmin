"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import type {
  QuickReportResponse,
  ErrorResponse,
  QuickReportMode,
  IncomeReport,
  ExpenseReport,
  AttendanceReport,
  PaymentMethod,
  RunQuickReportBody,
  Segment,
  AttendanceView,
  AttendanceSummaryRow,
  AttendanceDetailedServiceBlock,
  AttendanceDetailedSegmentBlock,
  AttendanceDetailedMemberRow,
} from "@/lib/reports/quick/types";

function isPaymentMethod(v: string): v is PaymentMethod {
  return v === "cash" || v === "cheque" || v === "online";
}
function isSegment(v: string): v is Segment {
  return v === "men" || v === "women" || v === "boys" || v === "girls";
}
function isAttendanceView(v: string): v is AttendanceView {
  return v === "summary" || v === "detailed";
}
function isQuickReportMode(v: string): v is QuickReportMode {
  return v === "income" || v === "expense" || v === "attendance";
}

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function moneyOrEmpty(n: number): string {
  return Math.abs(n) < 1e-9 ? "" : money(n);
}

export default function QuickReportPrintPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qs = sp.toString();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<QuickReportResponse | null>(null);

  const start = sp.get("start") ?? "";
  const end = sp.get("end") ?? "";

  // Minimal filters line (optional)
  const filtersLine = (() => {
    const tmp = new URLSearchParams(qs);
    const rawMode = tmp.get("mode") ?? "income";
    const mode: QuickReportMode = isQuickReportMode(rawMode)
      ? rawMode
      : "income";
    const service_ids = tmp.getAll("service_id");
    const category_ids = tmp.getAll("category_id");

    const parts: string[] = [];
    if (service_ids.length) parts.push(`Services: ${service_ids.length}`);
    if (mode !== "attendance" && category_ids.length)
      parts.push(`Categories: ${category_ids.length}`);
    return parts.join(" • ");
  })();

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");
        setData(null);

        const tmp = new URLSearchParams(qs);

        const organization_id = tmp.get("org") ?? "";
        const rawMode = tmp.get("mode") ?? "income";
        const mode: QuickReportMode = isQuickReportMode(rawMode)
          ? rawMode
          : "income";

       const rawExpenseSort = tmp.get("expense_sort") ?? "date";
const expenseSort = rawExpenseSort === "category" ? "category" : "date";
   

        const start_date = tmp.get("start") ?? "";
        const end_date = tmp.get("end") ?? "";

        if (!organization_id) throw new Error("Missing org in URL.");
        if (!start_date || !end_date)
          throw new Error("Missing start/end dates in URL.");

        const service_ids = tmp.getAll("service_id");
        const category_ids = tmp.getAll("category_id");
        const vendors = tmp.getAll("vendor");
        const age_groups = tmp.getAll("age_group");

        const payment_methods = tmp.getAll("method").filter(isPaymentMethod);
        const segments = tmp.getAll("segment").filter(isSegment);

        const rawView = tmp.get("view") ?? "summary";
        const view: AttendanceView = isAttendanceView(rawView)
          ? rawView
          : "summary";

        const { data: sessionRes, error: sessionErr } =
          await supabase.auth.getSession();
        if (sessionErr) throw new Error(sessionErr.message);

        const token = sessionRes.session?.access_token;
        if (!token) throw new Error("Not authenticated.");

        const body: RunQuickReportBody = {
          organization_id,
          mode,
          start_date,
          end_date,
          service_ids: service_ids.length ? service_ids : undefined,
          category_ids: category_ids.length ? category_ids : undefined,
          payment_methods: payment_methods.length ? payment_methods : undefined,
          vendors: vendors.length ? vendors : undefined,

          expense_sort: mode === "expense" ? expenseSort : undefined,

          segments:
            mode === "attendance" && segments.length ? segments : undefined,
          age_groups:
            mode === "attendance" && age_groups.length ? age_groups : undefined,
          view: mode === "attendance" ? view : undefined,
        };

        const res = await fetch("/api/reports/quick/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        const json: unknown = await res.json();

        if (!res.ok) {
          const errObj = json as Partial<ErrorResponse>;
          throw new Error(
            errObj.error || `Failed to run report (${res.status})`,
          );
        }

        if (!alive) return;
        setData(json as QuickReportResponse);
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
  }, [qs]);

  const headerText = data?.branding?.header_text ?? "Report";
  const subheaderText = data?.branding?.subheader_text ?? "Quick Report";
  const logoUrl = data?.branding?.logo_url ?? null;

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Print locking */}
      <style>{`
        
        @page { size: landscape; margin: 0.7in 0.6in; }
        .print-root { font-size: 11pt; line-height: 1.25; }

        .report-table {
        width: auto;               /* <— do NOT stretch full width */
        border-collapse: collapse;
        table-layout: fixed;       /* stable column widths */
        }

        .break-page {
        break-after: page;
        page-break-after: always;
        }

        .th-cell, .td-cell {
        white-space: nowrap;       /* stop vertical stacking */
        overflow: hidden;
        text-overflow: ellipsis;   /* truncate long headers/cells */
        }

        @media print {
        .print-hidden { display: none !important; }
        body { background: white !important; }
        .break-page:last-child {
            break-after: auto;
            page-break-after: auto;
        }
        }

      `}</style>

      {/* Top bar (never printed) */}
      <div className="print-hidden sticky top-0 z-10 border-b bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="text-sm text-slate-600">Print view</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              type="button"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="print-root px-10 py-8 print:px-6 print:py-6">
        {/* Header: centered, with your exact sizes */}
        <div className="text-center">
          {logoUrl ? (
            <div className="mb-3 flex justify-center">
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
            <div className="mb-3" />
          )}

          <div style={{ fontSize: "22pt", fontWeight: 700 }}>{headerText}</div>
          <div style={{ fontSize: "18pt", fontWeight: 700, marginTop: "6pt" }}>
            {subheaderText}
          </div>

          <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "10pt" }}>
            Time Period: {start} to {end}
          </div>

          {filtersLine ? (
            <div
              style={{ fontSize: "9pt", marginTop: "4pt", color: "#475569" }}
            >
              {filtersLine}
            </div>
          ) : null}
        </div>

        {/* Content: LEFT aligned (like your desired sheet), not centered */}
        <div className="mt-10">
          <div className="report-container">
            {loading ? (
              <div style={{ fontSize: "11pt", color: "#475569" }}>
                Loading report...
              </div>
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
    </div>
  );
}

function ReportBody({ data }: { data: QuickReportResponse }) {
  if (data.mode === "income") return <IncomeTable data={data} />;
  if (data.mode === "expense") return <ExpenseTable data={data} />;
  return <AttendanceBlocks data={data} />;
}

const INCOME_COLS_PER_CHUNK = 5;
const MEMBER_W = 280;
const CAT_W = 110;
const GRAND_W = 120;

function IncomeTable({ data }: { data: IncomeReport }) {
  const { columns, rows, colTotals, grandTotal } = data.table;

  const colChunks = chunkArray(columns, INCOME_COLS_PER_CHUNK);

  return (
    <div>
      {colChunks.map((chunk, idx) => {
        const showGrand = idx === colChunks.length - 1;

        return (
          <div
            key={idx}
            className={idx < colChunks.length - 1 ? "break-page" : ""}
          >
            <table className="report-table" style={{ fontSize: "11pt" }}>
              <colgroup>
                <col style={{ width: `${MEMBER_W}px` }} />
                {chunk.map((c) => (
                  <col key={c.id} style={{ width: `${CAT_W}px` }} />
                ))}
                {showGrand ? <col style={{ width: `${GRAND_W}px` }} /> : null}
              </colgroup>

              <thead>
                <tr>
                  <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
                    Member
                  </th>
                  {chunk.map((c) => (
                    <th
                      key={c.id}
                      title={c.name}
                      className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell"
                    >
                      {c.name}
                    </th>
                  ))}
                  {showGrand ? (
                    <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
                      Grand
                    </th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => (
                  <tr key={r.member_id}>
                    <td className="border border-black px-2 py-1 td-cell">
                      {r.member_name}
                    </td>
                    {chunk.map((c) => (
                      <td
                        key={c.id}
                        className="border border-black px-2 py-1 text-center td-cell"
                      >
                        {moneyOrEmpty(r.values[c.id] ?? 0)}
                      </td>
                    ))}
                    {showGrand ? (
                      <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
                        {money(r.total)}
                      </td>
                    ) : null}
                  </tr>
                ))}

                <tr>
                  <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">
                    Totals
                  </td>
                  {chunk.map((c) => (
                    <td
                      key={c.id}
                      className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell"
                    >
                      {money(colTotals[c.id] ?? 0)}
                    </td>
                  ))}
                  {showGrand ? (
                    <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
                      {money(grandTotal)}
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ExpenseTable({ data }: { data: ExpenseReport }) {
  const { rows, grandTotal } = data.table;

  const DATE_W = 130;
  const DESC_W = 300;
  const VENDOR_W = 190;
  const CAT_W = 170;
  const AMT_W = 130;

  return (
    <div style={{ fontSize: "11pt" }}>
      <table className="report-table">
        <colgroup>
          <col style={{ width: `${DATE_W}px` }} />
          <col style={{ width: `${DESC_W}px` }} />
          <col style={{ width: `${VENDOR_W}px` }} />
          <col style={{ width: `${CAT_W}px` }} />
          <col style={{ width: `${AMT_W}px` }} />
        </colgroup>

        <thead>
          <tr>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Date
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Description
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Vendor
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Category
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-right font-semibold th-cell">
              Amount
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, idx) => (
            <tr key={`${r.expense_date}__${r.category_id}__${idx}`}>
              <td className="border border-black px-2 py-1 td-cell">
                {r.expense_date}
              </td>
              <td
                className="border border-black px-2 py-1 td-cell"
                title={r.description}
              >
                {r.description}
              </td>
              <td
                className="border border-black px-2 py-1 td-cell"
                title={r.vendor}
              >
                {r.vendor}
              </td>
              <td
                className="border border-black px-2 py-1 td-cell"
                title={r.category_name}
              >
                {r.category_name}
              </td>
              <td className="border border-black px-2 py-1 text-right td-cell">
                {money(r.amount)}
              </td>
            </tr>
          ))}

          <tr>
            <td
              className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell"
              colSpan={4}
            >
              Grand Total
            </td>
            <td className="border border-black bg-slate-100 px-2 py-1 text-right font-semibold td-cell">
              {money(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function isAttendanceSummaryReport(
  r: AttendanceReport,
): r is Extract<AttendanceReport, { meta: { view: "summary" } }> {
  return r.meta.view === "summary";
}

function isAttendanceDetailedReport(
  r: AttendanceReport,
): r is Extract<AttendanceReport, { meta: { view: "detailed" } }> {
  return r.meta.view === "detailed";
}

function AttendanceBlocks({ data }: { data: AttendanceReport }) {
  if (isAttendanceSummaryReport(data)) {
    return <AttendanceSummaryTable rows={data.summary.rows} />;
  }
  if (isAttendanceDetailedReport(data)) {
    return <AttendanceDetailed services={data.detailed.services} />;
  }
  return null;
}

/** SUMMARY: Date | Service | Girls | Boys | Women | Men | Total */
function AttendanceSummaryTable({ rows }: { rows: AttendanceSummaryRow[] }) {
  const DATE_W = 140;
  const SVC_W = 260;
  const SEG_W = 110;
  const TOTAL_W = 110;

  return (
    <div style={{ fontSize: "11pt" }}>
      <table className="report-table">
        <colgroup>
          <col style={{ width: `${DATE_W}px` }} />
          <col style={{ width: `${SVC_W}px` }} />
          <col style={{ width: `${SEG_W}px` }} />
          <col style={{ width: `${SEG_W}px` }} />
          <col style={{ width: `${SEG_W}px` }} />
          <col style={{ width: `${SEG_W}px` }} />
          <col style={{ width: `${TOTAL_W}px` }} />
        </colgroup>

        <thead>
          <tr>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Date
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Service
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Girls
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Boys
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Women
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Men
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r: AttendanceSummaryRow) => (
            <tr key={`${r.date}__${r.service_id}`}>
              <td className="border border-black px-2 py-1 td-cell">
                {r.date}
              </td>
              <td
                className="border border-black px-2 py-1 td-cell"
                title={r.service_name}
              >
                {r.service_name}
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {r.girls || ""}
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {r.boys || ""}
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {r.women || ""}
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {r.men || ""}
              </td>
              <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
                {r.total || ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** DETAILED: per service -> per segment -> Member | Count + totals */
function AttendanceDetailed({
  services,
}: {
  services: AttendanceDetailedServiceBlock[];
}) {
  const NAME_W = 360;
  const COUNT_W = 120;

  return (
    <div className="grid gap-8" style={{ fontSize: "11pt" }}>
      {services.map((svc: AttendanceDetailedServiceBlock) => (
        <div key={svc.service_id}>
          <div className="mb-2 text-sm font-semibold">{svc.service_name}</div>

          <div className="grid gap-6">
            {svc.segments.map((seg: AttendanceDetailedSegmentBlock) => (
              <div key={`${svc.service_id}-${seg.segment}`}>
                <div className="mb-1 text-[10pt] font-semibold">
                  {seg.segment.toUpperCase()}
                </div>

                <table className="report-table">
                  <colgroup>
                    <col style={{ width: `${NAME_W}px` }} />
                    <col style={{ width: `${COUNT_W}px` }} />
                  </colgroup>

                  <thead>
                    <tr>
                      <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
                        Member
                      </th>
                      <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
                        Count
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {seg.rows.map((r: AttendanceDetailedMemberRow) => (
                      <tr key={r.member_id}>
                        <td
                          className="border border-black px-2 py-1 td-cell"
                          title={r.member_name}
                        >
                          {r.member_name}
                        </td>
                        <td className="border border-black px-2 py-1 text-center td-cell">
                          {r.count}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">
                        {seg.segment.toUpperCase()} Total
                      </td>
                      <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
                        {seg.total}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}

            <div className="text-sm font-semibold">
              Grand Total: {svc.grand_total}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
