// app/app/reports/converts-baptisms/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getActiveOrgId } from "@/lib/auth";
import { buildConvertsBaptismsPrintUrl } from "@/lib/reports/converts-baptisms/printUrl";

type ReportType = "baptisms" | "new_converts" | "combined";

export default function ConvertsBaptismsReportPage() {
  const router = useRouter();

  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    return toYmd(d);
  }, [today]);
  const defaultEnd = useMemo(() => toYmd(today), [today]);

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  const [reportType, setReportType] = useState<ReportType>("combined");
  const [includeArchived, setIncludeArchived] = useState(true);

  function openPrintView() {
    if (!start || !end) return alert("Please select a start and end date.");
    if (end < start) return alert("End date cannot be earlier than start date.");

    const orgId = getActiveOrgId();
    if (!orgId) return alert("No active organization selected.");

    const url = buildConvertsBaptismsPrintUrl({
      org: orgId,
      start,
      end,
      report_type: reportType,
      include_archived: includeArchived,
    });

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">
              Converts & Baptisms report
            </div>
            <div className="text-sm text-slate-600">
              Pick a date range, choose a report type, then open print view (save
              as PDF).
            </div>
          </div>

          <button
            onClick={() => router.push("/app/reports")}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black border"
            type="button"
          >
            Back to Reports
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xl font-semibold">FILTERS</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Filters apply to members whose{" "}
                    <span className="font-semibold">born-again date</span> and/or{" "}
                    <span className="font-semibold">baptism date</span> falls in
                    the range (depending on report type).
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-900">
                  <span className="font-semibold">Date range</span>

                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="rounded-lg border px-4 py-2 text-xs outline-none focus:border-slate-400"
                  />

                  <span className="text-slate-800">to</span>

                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="rounded-lg border px-4 py-2 text-xs outline-none focus:border-slate-400"
                  />
                </div>
              </div>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card title="Report type">
                  <div className="rounded-2xl border p-3">
                    <label className="flex items-center gap-3 py-2">
                      <input
                        type="radio"
                        name="report_type"
                        checked={reportType === "baptisms"}
                        onChange={() => setReportType("baptisms")}
                        className="h-4 w-4 accent-slate-900"
                      />
                      <span className="text-sm text-slate-800">Baptisms</span>
                    </label>

                    <label className="flex items-center gap-3 py-2">
                      <input
                        type="radio"
                        name="report_type"
                        checked={reportType === "new_converts"}
                        onChange={() => setReportType("new_converts")}
                        className="h-4 w-4 accent-slate-900"
                      />
                      <span className="text-sm text-slate-800">
                        New converts (Born again)
                      </span>
                    </label>

                    <label className="flex items-center gap-3 py-2">
                      <input
                        type="radio"
                        name="report_type"
                        checked={reportType === "combined"}
                        onChange={() => setReportType("combined")}
                        className="h-4 w-4 accent-slate-900"
                      />
                      <span className="text-sm text-slate-800">Combined</span>
                    </label>
                  </div>
                </Card>

                <Card title="Status">
                  <div className="rounded-2xl border p-3">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={includeArchived}
                        onChange={(e) => setIncludeArchived(e.target.checked)}
                        className="h-4 w-4 accent-slate-900"
                      />
                      <span className="text-sm text-slate-800">
                        Include archived
                      </span>
                    </label>
                  </div>

                  <div className="mt-2 text-xs text-slate-500">
                    If unchecked, report uses active records only.
                  </div>
                </Card>
              </div>

              <div className="mt-5">
                <button
                  onClick={openPrintView}
                  className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                  type="button"
                >
                  Open print view
                </button>

                <div className="mt-2 text-xs text-slate-500">
                  Tip: In the print view, choose{" "}
                  <span className="font-semibold">Save as PDF</span>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-white p-4">
      <div className="text-xs font-semibold text-slate-600">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
