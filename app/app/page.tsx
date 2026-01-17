"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LegendPayload } from "recharts";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import type { Payload, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { ReactNode } from "react";

type ServiceCategory = { id: string; name: string };

type KPI = {
  month_start: string;
  month_end: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  avg_attendance: number;
};

type RecentAggItem = {
  item_type: "income" | "expense" | "attendance";
  posted_at: string | null;
  happened_on: string;
  title: string;
  subtitle: string | null;
  amount_cents: number | null;
  attendance_count: number | null;
};

type MonthlyRow = {
  month_start: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
};
type TooltipPayload = readonly Payload<ValueType, NameType>[];
type LineKey = "income" | "expense" | "net";
function isLineKey(x: unknown): x is LineKey {
  return x === "income" || x === "expense" || x === "net";
}

function centsToDollars(cents: number | null | undefined) {
  return Number(cents ?? 0) / 100;
}

function formatMoneyFromCents(cents: number | null | undefined) {
  return centsToDollars(cents).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function monthShort(isoDate: string) {
  const dt = new Date(`${isoDate}T00:00:00`);
  return dt.toLocaleString(undefined, { month: "short" });
}

function monthYearTooltip(isoDate: string) {
  // "Jan -26"
  const dt = new Date(`${isoDate}T00:00:00`);
  const mon = dt.toLocaleString(undefined, { month: "short" });
  const yy = String(dt.getFullYear()).slice(-2);
  return `${mon} -${yy}`;
}

function formatDateShort(isoDate: string) {
  const dt = new Date(`${isoDate}T00:00:00`);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTimeShort(iso: string | null) {
  if (!iso) return "—";
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Failed to load dashboard.";
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

function parseCssRgb(input: string): { r: number; g: number; b: number } | null {
  // supports "rgb(r, g, b)" and "rgba(r, g, b, a)"
  const m = input
    .replace(/\s+/g, "")
    .match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function rgbToHsl(r: number, g: number, b: number) {
  // r,g,b: 0..255 => h:0..360, s/l:0..1
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  const l = (max + min) / 2;

  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / d) % 6;
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  // h:0..360, s/l:0..1 => r,g,b:0..255
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= hp && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (1 <= hp && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (2 <= hp && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (3 <= hp && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (4 <= hp && hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return { r, g, b };
}

function rgbString({ r, g, b }: { r: number; g: number; b: number }) {
  return `rgb(${r}, ${g}, ${b})`;
}

function getComputedPrimaryRgb(): string | null {
  if (typeof window === "undefined") return null;

  // Create a temp element with bg-primary, read its computed background-color
  const el = document.createElement("div");
  el.className = "bg-primary";
  el.style.display = "none";
  document.body.appendChild(el);

  const color = getComputedStyle(el).backgroundColor; // "rgb(...)"
  document.body.removeChild(el);

  return color || null;
}

function oppositeColorFromRgb(rgbCss: string): string | null {
  const rgb = parseCssRgb(rgbCss);
  if (!rgb) return null;

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const oppH = (h + 180) % 360;
  const oppRgb = hslToRgb(oppH, clamp01(s), clamp01(l));
  return rgbString(oppRgb);
}

export default function DashboardPage() {
  const [orgId, setOrgId] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceCategory[]>([]);
  const [serviceScope, setServiceScope] = useState<string>(""); // "all" or category.id

  const [kpi, setKpi] = useState<KPI | null>(null);
  const [recent, setRecent] = useState<RecentAggItem[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Income + Expense on, Net off by default
  const [visibleLines, setVisibleLines] = useState<Record<LineKey, boolean>>({
    income: true,
    expense: true,
    net: false,
  });

  // For “stretch chart to match recent list height”
  const recentCardRef = useRef<HTMLDivElement | null>(null);
  const [rightCardMinH, setRightCardMinH] = useState<number | undefined>(
    undefined
  );

  const [incomeColor, setIncomeColor] = useState<string>("rgb(0,0,0)");
  const [expenseColor, setExpenseColor] = useState<string>("rgb(0,0,0)");

  useEffect(() => {
    const primaryRgb = getComputedPrimaryRgb();
    if (!primaryRgb) return;

    const opp = oppositeColorFromRgb(primaryRgb);

    setIncomeColor(primaryRgb);
    setExpenseColor(opp ?? primaryRgb);
  }, []);


  useEffect(() => {
    setOrgId(getActiveOrgId());
  }, []);

  useEffect(() => {
    const el = recentCardRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      // tiny guard against 0 / NaN
      if (h > 100) setRightCardMinH(Math.round(h));
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [recent.length, loading]);

  const effectiveServiceCategoryId = useMemo(() => {
    if (!serviceScope || serviceScope === "all") return null;
    return serviceScope;
  }, [serviceScope]);

  const kpiIncome = kpi?.income_cents ?? 0;
  const kpiExpense = kpi?.expense_cents ?? 0;
  const kpiNet = kpi?.net_cents ?? kpiIncome - kpiExpense;
  const kpiAvgAttendance = kpi?.avg_attendance ?? 0;

  const chartData = useMemo(() => {
    // Jan -> Dec always (data already 12 rows from RPC)
    return monthly.map((r) => ({
      monthStart: r.month_start,
      monthLabel: monthShort(r.month_start),
      income: centsToDollars(r.income_cents),
      expense: centsToDollars(r.expense_cents),
      net: centsToDollars(r.net_cents),
    }));
  }, [monthly]);

  const onLegendClick = (
    payload: LegendPayload,
    _index: number,
    _event: React.MouseEvent<Element, MouseEvent>
  ) => {
    const dk = payload.dataKey;
    if (typeof dk !== "string" && typeof dk !== "number") return;
    if (!isLineKey(dk)) return;

    setVisibleLines((prev) => ({
      ...prev,
      [dk]: !prev[dk],
    }));
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!orgId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg(null);

      try {
        // Services (categories.type='services')
        const { data: svcData, error: svcErr } = await supabase
          .from("categories")
          .select("id,name")
          .eq("org_id", orgId)
          .eq("type", "services")
          .eq("status", "active")
          .order("name", { ascending: true });

        if (svcErr) throw svcErr;

        const servicesTyped: ServiceCategory[] = (svcData ?? []).map((x) => ({
          id: x.id,
          name: x.name,
        }));

        if (!cancelled) {
          setServices(servicesTyped);

          // Default scope: Sunday Service -> else first -> else all
          if (!serviceScope) {
            const sunday = servicesTyped.find(
              (s) => s.name.toLowerCase() === "sunday service"
            );
            setServiceScope(sunday?.id ?? servicesTyped[0]?.id ?? "all");
          }
        }

        // KPIs (this month; attendance scoped)
        const { data: kpiData, error: kpiErr } = await supabase.rpc(
          "dashboard_kpis",
          {
            p_org_id: orgId,
            p_service_category_id: effectiveServiceCategoryId,
          }
        );
        if (kpiErr) throw kpiErr;

        // Recent Published (aggregated) — LAST 4
        const { data: recentData, error: recentErr } = await supabase.rpc(
          "dashboard_recent_published_agg",
          { p_org_id: orgId, p_limit: 4 }
        );
        if (recentErr) throw recentErr;

        // Chart: Jan–Dec for current year
        const thisYear = new Date().getFullYear();
        const { data: monthlyData, error: monthlyErr } = await supabase.rpc(
          "dashboard_year_totals",
          { p_org_id: orgId, p_year: thisYear }
        );
        if (monthlyErr) throw monthlyErr;

        if (!cancelled) {
          setKpi(kpiData?.[0] ? (kpiData[0] as KPI) : null);
          setRecent((recentData ?? []) as RecentAggItem[]);
          setMonthly((monthlyData ?? []) as MonthlyRow[]);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMsg(getErrorMessage(err));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, effectiveServiceCategoryId]);

  // Tooltip: show "Jan -26"
  const tooltipLabelFormatter = (
    label: unknown,
    payload: TooltipPayload
  ): ReactNode => {
    
    const monthStart = payload[0]?.payload?.monthStart;

    if (typeof monthStart === "string") {
      return monthYearTooltip(monthStart);
    }

    if (typeof label === "string" || typeof label === "number") return String(label);

    return "";
  };

  return (
    <>
      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Dashboard</div>
            <div className="text-sm text-slate-600">
              Published summaries • Jan–Dec trend
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* <button className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              New Draft
            </button>
            <button className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
              Add Entry
            </button> */}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {!orgId ? (
          <div className="rounded-3xl border bg-white p-6">
            <div className="text-sm font-semibold">No active organization</div>
            <div className="mt-1 text-sm text-slate-600">
              Select an organization to see your dashboard.
            </div>
          </div>
        ) : null}

        {errorMsg ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {/* KPI cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Income */}
          <div className="rounded-3xl border bg-white p-5">
            <div className="text-xs text-slate-500">Income (This Month)</div>
            <div className="mt-2 text-2xl font-semibold">
              {loading ? "—" : formatMoneyFromCents(kpiIncome)}
            </div>
          </div>

          {/* Expense */}
          <div className="rounded-3xl border bg-white p-5">
            <div className="text-xs text-slate-500">Expense (This Month)</div>
            <div className="mt-2 text-2xl font-semibold">
              {loading ? "—" : formatMoneyFromCents(kpiExpense)}
            </div>
          </div>

          {/* Net */}
          <div className="rounded-3xl border bg-white p-5">
            <div className="text-xs text-slate-500">Net (This Month)</div>
            <div className="mt-2 text-2xl font-semibold">
              {loading ? "—" : formatMoneyFromCents(kpiNet)}
            </div>
          </div>

          {/* Avg Attendance + small scope dropdown inside */}
          <div className="rounded-3xl border bg-white p-5">
            {/* Label row */}
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                Avg Attendance (This Month)
              </div>

              <select
                className="h-6 rounded-lg border bg-white px-2 text-[11px] text-slate-700"
                value={serviceScope || "all"}
                onChange={(e) => setServiceScope(e.target.value)}
                title="Attendance scope"
              >
                <option value="all">All</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 text-2xl font-semibold">
              {loading ? "—" : kpiAvgAttendance.toFixed(1)}
            </div>

            {/* <div className="mt-1 text-[11px] text-slate-500">
              Scope:{" "}
              {serviceScope === "all"
                ? "All services"
                : services.find((s) => s.id === serviceScope)?.name ??
                  "Selected service"}
            </div> */}
          </div>
        </div>

        {/* Recent + Chart (stretch to match) */}
        <div className="grid gap-6 lg:grid-cols-12 items-stretch">
          {/* Recent Published */}
          <div
            ref={recentCardRef}
            className="rounded-3xl border bg-white p-5 lg:col-span-5 h-full"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xl font-semibold">Recently Published</div>
               
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {loading ? (
                <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-600">
                  Loading recent activity…
                </div>
              ) : recent.length === 0 ? (
                <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-600">
                  No published activity yet.
                </div>
              ) : (
                recent.map((r, idx) => {
                  const rightValue =
                    r.item_type === "attendance"
                      ? `${r.attendance_count ?? 0} ppl`
                      : formatMoneyFromCents(r.amount_cents ?? 0);

                  return (
                    <div
                      key={idx}
                      className="rounded-2xl border bg-white px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{r.title}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {r.subtitle ?? "—"} • {formatDateShort(r.happened_on)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Posted {formatDateTimeShort(r.posted_at)}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-semibold">{rightValue}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {r.item_type.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Chart */}
          <div
            className="rounded-3xl border bg-white p-5 lg:col-span-7 h-full flex flex-col"
            style={rightCardMinH ? { minHeight: rightCardMinH } : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xl font-semibold">Income vs Expense</div>
                
              </div>
            </div>

            <div className="mt-4 flex-1 rounded-2xl border bg-slate-50 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="monthLabel" />
                  <YAxis />
                  <Tooltip labelFormatter={tooltipLabelFormatter} />
                  <Legend
                    onClick={onLegendClick}
                    wrapperStyle={{ cursor: "pointer" }}
                  />

                  {/* Different line colors */}
                  {visibleLines.income ? (
                    <Line
                      type="monotone"
                      dataKey="income"
                      stroke={incomeColor}
                      strokeWidth={2}
                      dot={false}
                    />
                  ) : null}

                  {visibleLines.expense ? (
                    <Line
                      type="monotone"
                      dataKey="expense"
                      stroke={expenseColor}
                      strokeWidth={2}
                      strokeDasharray="6 6"
                      dot={false}
                    />
                  ) : null}

                  {visibleLines.net ? (
                    <Line
                      type="monotone"
                      dataKey="net"
                      stroke="#0f172a" // slate-ish
                      strokeWidth={2}
                      strokeDasharray="6 6"
                      dot={false}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
