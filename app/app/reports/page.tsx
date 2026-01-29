"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

async function getMyRoleForOrg(orgId: string): Promise<{
  role: Role | null;
  userId: string | null;
  error: string | null;
}> {
  const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user?.id ?? null;
  if (sessErr) return { role: null, userId, error: sessErr.message };
  if (!userId) return { role: null, userId: null, error: "No session user." };

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .limit(1); // avoids maybeSingle() exploding on duplicates

  if (error) return { role: null, userId, error: error.message };

  const role = (data?.[0]?.role as Role | undefined) ?? null;
  return { role, userId, error: null };
}


export default function ReportsHomePage() {
  const router = useRouter();

const [role, setRole] = useState<Role | null>(null);
const [roleLoaded, setRoleLoaded] = useState(false);
const [roleErr, setRoleErr] = useState<string>("");

const orgId = getActiveOrgId();

useEffect(() => {
  let alive = true;

  (async () => {
    if (!orgId) {
      if (!alive) return;
      setRoleLoaded(true);
      setRoleErr("No active organization selected.");
      return;
    }

    const res = await getMyRoleForOrg(orgId);
    if (!alive) return;

    setRole(res.role);          
    setRoleErr(res.error ?? ""); // optional
    setRoleLoaded(true);

  })();

  return () => {
    alive = false;
  };
}, [orgId]);


  const canSeeFinancialReports = useMemo(() => {
    return role === "owner" || role === "admin";
  }, [role]);

  const items = useMemo(
    () => [
      {
        title: "Quick report",
        desc: "Fast summaries for Income, Expense, and Attendance with printable output.",
        href: "/app/reports/quick",
        badge: "",
        requiresAdmin: false,
      },
      {
        title: "Income statement",
        desc: "Income vs Expense breakdown for a date range.",
        href: "/app/reports/income-statement",
        badge: "",
        requiresAdmin: true,
      },
      {
        title: "Member giving report",
        desc: "See giving by member and category.",
        href: "/app/reports/member-giving",
        badge: "",
        requiresAdmin: true,
      },
       {
        title: "First-timers report",
        desc: "See reports of first-timers and visitors.",
        href: "/app/reports/first-timers",
        badge: "",
        requiresAdmin: false,
      },
      {
        title: "New Converts and Baptisms report",
        desc: "Generate reports for baptisms and new converts within a selected date range.",
        href: "/app/reports/converts-baptisms",
        badge: "",
        requiresAdmin: false,
      },
    ],
    [],
  );

  

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
              <div className="text-sm font-semibold">WHAT REPORT WOULD YOU LIKE TO RUN?</div>
            </div>

            <div className="divide-y">
              {items.map((it) => {
                const locked =
                  it.requiresAdmin && roleLoaded && !canSeeFinancialReports;

                const tooltip = locked
                  ? "Admins/Owners only. Ask an admin to grant access."
                  : "";

                return (
                  <button
                    key={it.href}
                    onClick={() => {
                      if (!locked) router.push(it.href);
                    }}
                    disabled={locked}
                    title={tooltip}
                    className={[
                      "w-full px-5 py-4 text-left",
                      locked
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold">{it.title}</div>

                          {it.requiresAdmin ? (
                            <span
                              className={[
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                locked
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-slate-200 bg-slate-50 text-slate-600",
                              ].join(" ")}
                            >
                              {locked ? "Locked" : "Admin"}
                            </span>
                          ) : null}

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

                        <div className="mt-1 text-sm text-slate-600">
                          {it.desc}
                        </div>

                        {locked ? (
                          <div className="mt-2 text-xs text-amber-800">
                            Admins/Owners only. Ask an admin to grant access.
                          </div>
                        ) : null}
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
