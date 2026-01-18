"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type {
  IncomeStatementReport,
  ErrorResponse,
  RunIncomeStatementBody,
  IncomeStatementLine,
} from "@/lib/reports/income-statement/types";

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function moneyOrEmpty(n: number) {
  return Math.abs(n) < 1e-9 ? "" : money(n);
}

function isMethod(v: string): v is "cash" | "cheque" | "online" {
  return v === "cash" || v === "cheque" || v === "online";
}

export default function IncomeStatementPrintPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qs = sp.toString();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<IncomeStatementReport | null>(null);

  const start = sp.get("start") ?? "";
  const end = sp.get("end") ?? "";

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");
        setData(null);

        const tmp = new URLSearchParams(qs);
        const organization_id = tmp.get("org") ?? "";
        const start_date = tmp.get("start") ?? "";
        const end_date = tmp.get("end") ?? "";

        if (!organization_id) throw new Error("Missing org in URL.");
        if (!start_date || !end_date) throw new Error("Missing start/end dates in URL.");

        const service_ids = tmp.getAll("service_id");
        const income_category_ids = tmp.getAll("income_category_id");
        const expense_category_ids = tmp.getAll("expense_category_id");
        const payment_methods = tmp.getAll("method").filter(isMethod);

        const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw new Error(sessionErr.message);

        const token = sessionRes.session?.access_token;
        if (!token) throw new Error("Not authenticated.");

        const body: RunIncomeStatementBody = {
          organization_id,
          start_date,
          end_date,
          service_ids: service_ids.length ? service_ids : undefined,
          income_category_ids: income_category_ids.length ? income_category_ids : undefined,
          expense_category_ids: expense_category_ids.length ? expense_category_ids : undefined,
          payment_methods: payment_methods.length ? payment_methods : undefined,
        };

        const res = await fetch("/api/reports/income-statement/run", {
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
          throw new Error(errObj.error || `Failed to run report (${res.status})`);
        }

        if (!alive) return;
        setData(json as IncomeStatementReport);
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

  const logoUrl = data?.branding.logo_url ?? null;
  const headerText = data?.branding.header_text ?? "Report";
  const subheaderText = "Income Statement";

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar (never printed) */}
      <div className="print-hidden sticky top-0 z-10 border-b bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="text-sm text-slate-600">Print view</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              type="button"
            >
              Back
            </button>
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

      <div className="print-root px-10 py-8 print:px-6 print:pt-2 print:pb-4">
        {/* Header */}
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

          <div style={{ fontSize: "22pt", fontWeight: 700, lineHeight: 1.1 }}>{headerText}</div>
          <div style={{ fontSize: "18pt", fontWeight: 700, marginTop: "6pt", lineHeight: 1.1 }}>
            {subheaderText}
          </div>

          <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "10pt" }}>
            Time Period: {start} to {end}
          </div>
        </div>

        {/* Content */}
        <div className="mt-10">
          <div className="report-container">
            {loading ? (
              <div style={{ fontSize: "11pt", color: "#475569" }}>Loading report...</div>
            ) : err ? (
              <div style={{ fontSize: "11pt", color: "#b91c1c" }}>{err}</div>
            ) : data ? (
              <IncomeStatementBody data={data} />
            ) : (
              <div style={{ fontSize: "11pt", color: "#475569" }}>No data.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IncomeStatementBody({ data }: { data: IncomeStatementReport }) {
  const income = data.statement.income;
  const expenses = data.statement.expenses;
  const { total_income, total_expense, net_income } = data.statement.totals;

  return (
    <div className="grid gap-10" style={{ fontSize: "11pt" }}>
      <StatementSection title="Income" lines={income} totalLabel="Total Income" totalValue={total_income} />
      <StatementSection title="Expenses" lines={expenses} totalLabel="Total Expense" totalValue={total_expense} />

      <div className="max-w-[680px]">
        <table className="report-table">
          <colgroup>
            <col style={{ width: "520px" }} />
            <col style={{ width: "160px" }} />
          </colgroup>
          <tbody>
            <tr>
              <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">Net Income</td>
              <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
                {money(net_income)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatementSection({
  title,
  lines,
  totalLabel,
  totalValue,
}: {
  title: string;
  lines: IncomeStatementLine[];
  totalLabel: string;
  totalValue: number;
}) {
  return (
    <div className="max-w-[680px]">
      <div className="mb-2 text-sm font-semibold">{title}</div>

      <table className="report-table">
        <colgroup>
          <col style={{ width: "520px" }} />
          <col style={{ width: "160px" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Category
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.category_id}>
              <td className="border border-black px-2 py-1 td-cell" title={l.category_name}>
                {l.category_name}
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {moneyOrEmpty(l.amount)}
              </td>
            </tr>
          ))}

          <tr>
            <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">{totalLabel}</td>
            <td className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold td-cell">
              {money(totalValue)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
