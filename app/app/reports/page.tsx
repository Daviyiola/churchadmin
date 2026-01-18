"use client";

import { useRouter } from "next/navigation";

export default function ReportsHomePage() {
  const router = useRouter();

  const items = [
    {
      title: "Quick report",
      desc: "Fast summaries for Income, Expense, and Attendance with printable output.",
      href: "/app/reports/quick",
      badge: "",
    },
    {
      title: "Income statement",
      desc: "Income vs Expense breakdown for a date range.",
      href: "/app/reports/income-statement",     
    },
    {
      title: "Member giving report",
      desc: "See giving by member and category (coming soon).",
      href: "/app/reports/member-giving",
      badge: "Soon",
      disabled: true,
    },
  ];

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Reports</div>
            <div className="text-sm text-slate-600">
              Run reports and export printable views.
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="text-xs font-semibold">REPORT TYPES</div>
            </div>

            <div className="divide-y">
              {items.map((it) => {
                const isDisabled = Boolean(it.disabled);

                return (
                  <button
                    key={it.href}
                    onClick={() => {
                      if (!isDisabled) router.push(it.href);
                    }}
                    disabled={isDisabled}
                    className={[
                      "w-full px-5 py-4 text-left",
                      isDisabled ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold">{it.title}</div>
                          {it.badge ? (
                            <span
                              className={[
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                it.badge === "New"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600",
                              ].join(" ")}
                            >
                              {it.badge}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{it.desc}</div>
                      </div>

                      <div className="text-sm text-slate-500">›</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 text-xs text-slate-500">
            Tip: Quick report is the fastest way to get printable summaries.
          </div>
        </div>
      </div>
    </>
  );
}
