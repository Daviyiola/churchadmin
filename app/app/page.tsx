"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LegendPayload } from "recharts";
import type {
  Payload,
  ValueType,
  NameType,
} from "recharts/types/component/DefaultTooltipContent";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

/** ========= Types ========= */

type Role = "owner" | "admin" | "finance" | "member" | "viewer";

type Gender = "male" | "female";
type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";
type Segment = "men" | "women" | "boys" | "girls";

type CategoryType = "income" | "expense" | "services";

type CategoryRow = {
  id: string;
  name: string;
  type: CategoryType;
  status: "active" | "archived";
};

type ServiceCategory = { id: string; name: string };

type MemberRow = {
  id: string;
  org_id: string;
  status: "active" | "archived";
  gender: Gender | null;
  joined_at: string | null; // date
  membership_stage:
    | "visitor"
    | "regular_attender"
    | "member"
    | "stopped_attending";
};

type AttendanceEntryRow = {
  org_id: string;
  service_category_id: string;
  session_date: string; // date
  gender: Gender;
  age_group: AgeGroup;
  segment: Segment;
  count: number;
};

type IncomeEntryRow = {
  org_id: string;
  session_date: string; // date
  income_category_id: string;
  amount_cents: number;
};

type ExpenseEntryRow = {
  org_id: string;
  expense_date: string; // date
  expense_category_id: string;
  amount_cents: number;
};

type IncomeBatchRow = {
  id: string;
  org_id: string;
  status: "draft" | "published";
  session_date: string; // date
  posted_at: string | null;
};

type ExpenseBatchRow = {
  id: string;
  org_id: string;
  status: "draft" | "published";
  period_month: string; // date
  posted_at: string | null;
};

type AttendanceSessionRow = {
  id: string;
  org_id: string;
  status: "draft" | "published";
  session_date: string; // date
  service_category_id: string;
  published_at: string | null;
};

type RecentItem = {
  item_type: "income" | "expense" | "attendance";
  posted_at: string | null;
  happened_on: string;
  title: string;
  subtitle: string | null;
  amount_cents: number | null;
  attendance_count: number | null;
};

type TooltipPayload = readonly Payload<ValueType, NameType>[];

/** ========= Utilities (no any) ========= */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Something went wrong.";
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function inRangeDate(iso: string, from: Date, toExclusive: Date): boolean {
  const dt = new Date(`${iso}T00:00:00`);
  return dt >= from && dt < toExclusive;
}

function centsToDollars(cents: number | null | undefined): number {
  return Number(cents ?? 0) / 100;
}

function formatMoneyFromCents(cents: number | null | undefined): string {
  return centsToDollars(cents).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function monthShort(isoMonthStart: string): string {
  const dt = new Date(`${isoMonthStart}T00:00:00`);
  return dt.toLocaleString(undefined, { month: "short" });
}

function monthYearTooltip(isoMonthStart: string): string {
  const dt = new Date(`${isoMonthStart}T00:00:00`);
  const mon = dt.toLocaleString(undefined, { month: "short" });
  const yy = String(dt.getFullYear()).slice(-2);
  return `${mon} -${yy}`;
}

function formatDateShort(isoD: string): string {
  const dt = new Date(`${isoD}T00:00:00`);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function parseCssRgb(
  input: string,
): { r: number; g: number; b: number } | null {
  const m = input
    .replace(/\s+/g, "")
    .match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
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

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (0 <= hp && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (1 <= hp && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (2 <= hp && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (3 <= hp && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (4 <= hp && hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbString({ r, g, b }: { r: number; g: number; b: number }): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function getComputedPrimaryRgb(): string | null {
  if (typeof window === "undefined") return null;
  const el = document.createElement("div");
  el.className = "bg-primary";
  el.style.display = "none";
  document.body.appendChild(el);
  const color = getComputedStyle(el).backgroundColor;
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

async function getMyRoleForOrg(orgId: string): Promise<Role | null> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  const r = data?.role;
  if (
    r === "owner" ||
    r === "admin" ||
    r === "finance" ||
    r === "member" ||
    r === "viewer"
  ) {
    return r;
  }
  return null;
}

/** ========= UI Bits ========= */

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {children}
    </span>
  );
}

type TabKey = "finance" | "people";

type FinanceYtdMetric = "income" | "expense" | "net";
type FinanceTopPeriod = "month" | "year";
type FinanceTopType = "income" | "expense";

type PeoplePeriod = "month" | "year";
type PeopleGender = "all" | Gender;
type PeopleAgeGroup = "all" | AgeGroup;

/** ========= Main Page ========= */

export default function DashboardPage() {
  const [orgId, setOrgId] = useState<string | null>(null);

  const [role, setRole] = useState<Role | null>(null);
  const canSeeFinance = role === "owner" || role === "admin";

  const [tab, setTab] = useState<TabKey>("people");

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceCategory[]>([]);
  const [categoriesIncome, setCategoriesIncome] = useState<CategoryRow[]>([]);
  const [categoriesExpense, setCategoriesExpense] = useState<CategoryRow[]>([]);

  const incomeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoriesIncome) m.set(c.id, c.name);
    return m;
  }, [categoriesIncome]);

  const expenseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoriesExpense) m.set(c.id, c.name);
    return m;
  }, [categoriesExpense]);

  // Recently published (shared)
  const [recent, setRecent] = useState<RecentItem[]>([]);

  // Finance view state
  const [financeYtdMetric, setFinanceYtdMetric] =
    useState<FinanceYtdMetric>("net");
  const [financeTopPeriod, setFinanceTopPeriod] =
    useState<FinanceTopPeriod>("month");
  const [financeTopType, setFinanceTopType] =
    useState<FinanceTopType>("expense");

  const [financeKpi, setFinanceKpi] = useState<{
    income_mtd: number;
    expense_mtd: number;
    net_mtd: number;
    ytd: number;
  } | null>(null);

  const [financeMonthly, setFinanceMonthly] = useState<
    Array<{ month_start: string; income: number; expense: number; net: number }>
  >([]);

  const [financeTopBars, setFinanceTopBars] = useState<
    Array<{ label: string; value: number }>
  >([]);

  // People view state
  const [peopleServiceScope, setPeopleServiceScope] = useState<string>("all"); // service id or "all"
  const effectiveServiceId = useMemo(() => {
    if (!peopleServiceScope || peopleServiceScope === "all") return null;
    return peopleServiceScope;
  }, [peopleServiceScope]);

  const [peopleAgeGroupFocus, setPeopleAgeGroupFocus] =
    useState<PeopleAgeGroup>("18-35");
  const [peoplePeriod, setPeoplePeriod] = useState<PeoplePeriod>("month");
  const [peopleGenderFilter, setPeopleGenderFilter] =
    useState<PeopleGender>("all");
  const [peopleAgeFilter, setPeopleAgeFilter] = useState<PeopleAgeGroup>("all");

  const [peopleKpi, setPeopleKpi] = useState<{
    total_active_all: number;
    total_active_female: number;
    total_active_male: number;

    new_mtd_all: number;
    new_mtd_female: number;
    new_mtd_male: number;

    avg_att_mtd_all: number;
    avg_att_mtd_female: number;
    avg_att_mtd_male: number;

    avg_att_age_all: number;
    avg_att_age_female: number;
    avg_att_age_male: number;
  } | null>(null);

  const [peopleMonthlyAvg, setPeopleMonthlyAvg] = useState<
    Array<{ month_start: string; avg_all: number }>
  >([]);

  const [peopleDemoBars, setPeopleDemoBars] = useState<
    Array<{ label: string; value: number }>
  >([]);

  // Chart styling
  const CHART_MIN_HEIGHT = 420;
  const recentCardRef = useRef<HTMLDivElement | null>(null);
  const [rightCardMinH, setRightCardMinH] = useState<number | undefined>(
    undefined,
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
      if (h > 100) setRightCardMinH(Math.round(h));
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [recent.length, loading]);

  // Force tab based on role: finance/member/viewer cannot see finance tab
  useEffect(() => {
    if (!canSeeFinance && tab === "finance") setTab("people");
  }, [canSeeFinance, tab]);

  // Tooltip label formatter
  const tooltipLabelFormatter = (
    label: unknown,
    payload: TooltipPayload,
  ): ReactNode => {
    const monthStart =
      payload[0]?.payload?.month_start ?? payload[0]?.payload?.monthStart;
    if (typeof monthStart === "string") return monthYearTooltip(monthStart);
    if (typeof label === "string" || typeof label === "number")
      return String(label);
    return "";
  };

  /** ========= Data loaders ========= */

  useEffect(() => {
    let cancelled = false;

    async function loadBase() {
      if (!orgId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg(null);

      try {
        const myRole = await getMyRoleForOrg(orgId);
        if (!cancelled) setRole(myRole);

        // Load categories (services + income + expense)
        const [svcRes, incRes, expRes] = await Promise.all([
          supabase
            .from("categories")
            .select("id,name,type,status")
            .eq("org_id", orgId)
            .eq("type", "services")
            .eq("status", "active")
            .order("name", { ascending: true }),
          supabase
            .from("categories")
            .select("id,name,type,status")
            .eq("org_id", orgId)
            .eq("type", "income")
            .eq("status", "active")
            .order("name", { ascending: true }),
          supabase
            .from("categories")
            .select("id,name,type,status")
            .eq("org_id", orgId)
            .eq("type", "expense")
            .eq("status", "active")
            .order("name", { ascending: true }),
        ]);

        if (svcRes.error) throw svcRes.error;
        if (incRes.error) throw incRes.error;
        if (expRes.error) throw expRes.error;

        const svcTyped: ServiceCategory[] = (svcRes.data ?? []).map((x) => ({
          id: (x as { id: string }).id,
          name: (x as { name: string }).name,
        }));

        if (!cancelled) {
          setServices(svcTyped);
          setCategoriesIncome((incRes.data ?? []) as CategoryRow[]);
          setCategoriesExpense((expRes.data ?? []) as CategoryRow[]);

          // Default service: Sunday Service if exists else first else all
          if (!peopleServiceScope) {
            const sunday = svcTyped.find(
              (s) => s.name.toLowerCase() === "sunday service",
            );
            setPeopleServiceScope(sunday?.id ?? svcTyped[0]?.id ?? "all");
          }
        }

        // Recently Published (shared)
        const recentItems = await loadRecentPublished(orgId, svcTyped);
        if (!cancelled) setRecent(recentItems);

        setLoading(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMsg(getErrorMessage(err));
          setLoading(false);
        }
      }
    }

    loadBase();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Load Finance view whenever tab/filters change
  useEffect(() => {
    let cancelled = false;

    async function loadFinance() {
      if (!orgId) return;
      if (!canSeeFinance) return;
      if (tab !== "finance") return;

      setErrorMsg(null);

      try {
        const now = new Date();
        const m0 = startOfMonth(now);
        const m1 = addMonths(m0, 1);
        const y0 = startOfYear(now);
        const y1 = new Date(now.getFullYear() + 1, 0, 1);

        // fetch all year entries once; compute everything client-side for demo reliability
        const [incRes, expRes] = await Promise.all([
          supabase
            .from("income_entries")
            .select("org_id,session_date,income_category_id,amount_cents")
            .eq("org_id", orgId)
            .gte("session_date", isoDate(y0))
            .lt("session_date", isoDate(y1)),
          supabase
            .from("expense_entries")
            .select("org_id,expense_date,expense_category_id,amount_cents")
            .eq("org_id", orgId)
            .gte("expense_date", isoDate(y0))
            .lt("expense_date", isoDate(y1)),
        ]);

        if (incRes.error) throw incRes.error;
        if (expRes.error) throw expRes.error;

        const inc = (incRes.data ?? []) as IncomeEntryRow[];
        const exp = (expRes.data ?? []) as ExpenseEntryRow[];

        // MTD sums
        const incomeMtd = inc
          .filter((r) => inRangeDate(r.session_date, m0, m1))
          .reduce((s, r) => s + (r.amount_cents ?? 0), 0);

        const expenseMtd = exp
          .filter((r) => inRangeDate(r.expense_date, m0, m1))
          .reduce((s, r) => s + (r.amount_cents ?? 0), 0);

        const netMtd = incomeMtd - expenseMtd;

        // YTD metric dropdown
        const incomeYtd = inc.reduce((s, r) => s + (r.amount_cents ?? 0), 0);
        const expenseYtd = exp.reduce((s, r) => s + (r.amount_cents ?? 0), 0);
        const netYtd = incomeYtd - expenseYtd;

        const ytd =
          financeYtdMetric === "income"
            ? incomeYtd
            : financeYtdMetric === "expense"
              ? expenseYtd
              : netYtd;

        // Monthly line data Jan–Dec
        const months: Array<{
          month_start: string;
          income: number;
          expense: number;
          net: number;
        }> = Array.from({ length: 12 }).map((_, i) => {
          const d = new Date(now.getFullYear(), i, 1);
          return {
            month_start: isoDate(d),
            income: 0,
            expense: 0,
            net: 0,
          };
        });

        for (const r of inc) {
          const dt = new Date(`${r.session_date}T00:00:00`);
          const idx = dt.getMonth();
          if (idx >= 0 && idx < 12) months[idx].income += r.amount_cents ?? 0;
        }
        for (const r of exp) {
          const dt = new Date(`${r.expense_date}T00:00:00`);
          const idx = dt.getMonth();
          if (idx >= 0 && idx < 12) months[idx].expense += r.amount_cents ?? 0;
        }
        for (const m of months) m.net = m.income - m.expense;

        // Top categories bar chart
        const topFrom = financeTopPeriod === "month" ? m0 : y0;
        const topTo = financeTopPeriod === "month" ? m1 : y1;

        const bars = computeTopCategories({
          topType: financeTopType,
          from: topFrom,
          toExclusive: topTo,
          incomeRows: inc,
          expenseRows: exp,
          incomeNames: incomeNameById,
          expenseNames: expenseNameById,
          limit: 7,
        });

        if (!cancelled) {
          setFinanceKpi({
            income_mtd: incomeMtd,
            expense_mtd: expenseMtd,
            net_mtd: netMtd,
            ytd,
          });
          setFinanceMonthly(months);
          setFinanceTopBars(bars);
        }
      } catch (err: unknown) {
        if (!cancelled) setErrorMsg(getErrorMessage(err));
      }
    }

    loadFinance();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orgId,
    tab,
    canSeeFinance,
    financeYtdMetric,
    financeTopPeriod,
    financeTopType,
    incomeNameById,
    expenseNameById,
  ]);

  // Load People view whenever tab/filters change
  useEffect(() => {
    let cancelled = false;

    async function loadPeople() {
      if (!orgId) return;
      if (tab !== "people") return;

      setErrorMsg(null);

      try {
        const now = new Date();
        const m0 = startOfMonth(now);
        const m1 = addMonths(m0, 1);
        const y0 = startOfYear(now);
        const y1 = new Date(now.getFullYear() + 1, 0, 1);

        // Members for counts
        const memRes = await supabase
          .from("members")
          .select("id,org_id,status,gender,joined_at,membership_stage")
          .eq("org_id", orgId);

        if (memRes.error) throw memRes.error;
        const members = (memRes.data ?? []) as MemberRow[];

        const activeMembers = members.filter((m) => m.status === "active");
        const totalFemale = activeMembers.filter(
          (m) => m.gender === "female",
        ).length;
        const totalMale = activeMembers.filter(
          (m) => m.gender === "male",
        ).length;
        const totalAll = activeMembers.length;

        // New people MTD (joined_at in month + active)
        const newMtd = activeMembers.filter((m) => {
          if (!m.joined_at) return false;
          return inRangeDate(m.joined_at, m0, m1);
        });
        const newMtdFemale = newMtd.filter((m) => m.gender === "female").length;
        const newMtdMale = newMtd.filter((m) => m.gender === "male").length;

        // Attendance entries for year (used for charts + month KPIs)
        const attRes = await supabase
          .from("attendance_entries")
          .select(
            "org_id,service_category_id,session_date,gender,age_group,segment,count",
          )
          .eq("org_id", orgId)
          .gte("session_date", isoDate(y0))
          .lt("session_date", isoDate(y1));

        if (attRes.error) throw attRes.error;
        const att = (attRes.data ?? []) as AttendanceEntryRow[];

        const scoped = effectiveServiceId
          ? att.filter((r) => r.service_category_id === effectiveServiceId)
          : att;

        // Avg Attendance MTD (overall + male/female), average per session_date
        const mtdRows = scoped.filter((r) =>
          inRangeDate(r.session_date, m0, m1),
        );
        const avgMtdAll = avgAttendancePerSession(mtdRows, "all");
        const avgMtdFemale = avgAttendancePerSession(mtdRows, "female");
        const avgMtdMale = avgAttendancePerSession(mtdRows, "male");

        // Avg Attendance by selected age group (MTD), with male/female split
        const ageFocusRows = mtdRows.filter(
          (r) => r.age_group === peopleAgeGroupFocus,
        );
        const avgAgeAll = avgAttendancePerSession(ageFocusRows, "all");
        const avgAgeFemale = avgAttendancePerSession(ageFocusRows, "female");
        const avgAgeMale = avgAttendancePerSession(ageFocusRows, "male");

        // Line chart Jan–Dec avg attendance (per month)
        const months: Array<{ month_start: string; avg_all: number }> =
          Array.from({ length: 12 }).map((_, i) => {
            const d = new Date(now.getFullYear(), i, 1);
            return { month_start: isoDate(d), avg_all: 0 };
          });

        for (let i = 0; i < 12; i++) {
          const from = new Date(now.getFullYear(), i, 1);
          const to = new Date(now.getFullYear(), i + 1, 1);
          const rows = scoped.filter((r) =>
            inRangeDate(r.session_date, from, to),
          );
          months[i].avg_all = avgAttendancePerSession(rows, "all");
        }

        // Demographics bar chart
        const demoFrom = peoplePeriod === "month" ? m0 : y0;
        const demoTo = peoplePeriod === "month" ? m1 : y1;

        const demoRows = scoped.filter((r) =>
          inRangeDate(r.session_date, demoFrom, demoTo),
        );

        const demoFiltered = demoRows.filter((r) => {
          if (peopleGenderFilter !== "all" && r.gender !== peopleGenderFilter)
            return false;
          if (peopleAgeFilter !== "all" && r.age_group !== peopleAgeFilter)
            return false;
          return true;
        });

        // show bars by segment (men/women/boys/girls)
        const segOrder: Segment[] = ["men", "women", "boys", "girls"];
        const segMap = new Map<Segment, number>();
        for (const s of segOrder) segMap.set(s, 0);
        for (const r of demoFiltered) {
          segMap.set(r.segment, (segMap.get(r.segment) ?? 0) + (r.count ?? 0));
        }
        const demoBars = segOrder.map((s) => ({
          label: s,
          value: segMap.get(s) ?? 0,
        }));

        if (!cancelled) {
          setPeopleKpi({
            total_active_all: totalAll,
            total_active_female: totalFemale,
            total_active_male: totalMale,

            new_mtd_all: newMtd.length,
            new_mtd_female: newMtdFemale,
            new_mtd_male: newMtdMale,

            avg_att_mtd_all: avgMtdAll,
            avg_att_mtd_female: avgMtdFemale,
            avg_att_mtd_male: avgMtdMale,

            avg_att_age_all: avgAgeAll,
            avg_att_age_female: avgAgeFemale,
            avg_att_age_male: avgAgeMale,
          });
          setPeopleMonthlyAvg(months);
          setPeopleDemoBars(demoBars);
        }
      } catch (err: unknown) {
        if (!cancelled) setErrorMsg(getErrorMessage(err));
      }
    }

    loadPeople();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orgId,
    tab,
    effectiveServiceId,
    peopleAgeGroupFocus,
    peoplePeriod,
    peopleGenderFilter,
    peopleAgeFilter,
  ]);

  /** ========= Derived Chart Data ========= */

  const financeChartData = useMemo(() => {
    return financeMonthly.map((m) => ({
      month_start: m.month_start,
      monthLabel: monthShort(m.month_start),
      income: centsToDollars(m.income),
      expense: centsToDollars(m.expense),
      net: centsToDollars(m.net),
    }));
  }, [financeMonthly]);

  const peopleLineData = useMemo(() => {
    return peopleMonthlyAvg.map((m) => ({
      month_start: m.month_start,
      monthLabel: monthShort(m.month_start),
      avg: Number(m.avg_all.toFixed(1)),
    }));
  }, [peopleMonthlyAvg]);

  /** ========= UI helpers ========= */

  const FinanceKpiCard = ({
    title,
    value,
    rightMeta,
  }: {
    title: string;
    value: string;
    rightMeta?: ReactNode;
  }) => (
    <div className="rounded-3xl border bg-white p-5">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold">{loading ? "—" : value}</div>
        {rightMeta ? (
          <div className="text-[11px] text-slate-600">{rightMeta}</div>
        ) : null}
      </div>
    </div>
  );

  const PeopleKpiCard = ({
    title,
    big,
    female,
    male,
    rightControl,
    onClick,
    selected,
    titleHint,
  }: {
    title: string;
    big: string | number;
    female: number | string;
    male: number | string;
    rightControl?: ReactNode;
    onClick?: () => void;
    selected?: boolean;
    titleHint?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border p-5 text-left transition ${
        selected ? "border-primary bg-white" : "bg-white hover:bg-slate-50"
      }`}
      title={titleHint}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">{title}</div>
        {rightControl ? rightControl : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold text-slate-900">
          {loading ? "—" : big}
        </div>

        <div className="text-[11px] text-slate-600 flex gap-3">
          <span>
            <span className="font-semibold">Female</span>: {female}
          </span>
          <span>
            <span className="font-semibold">Male</span>: {male}
          </span>
        </div>
      </div>
    </button>
  );

  /** ========= Render ========= */

  if (!orgId) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border bg-white p-6">
          <div className="text-sm font-semibold">No active organization</div>
          <div className="mt-1 text-sm text-slate-600">
            Select an organization to see your dashboard.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header + tabs */}
      <div className="border-b">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="mt-70">
              <div className="text-xl font-semibold ">Dashboard</div>
              <div className="text-sm text-slate-600">
                Published summaries • Jan–Dec trend
              </div>
            </div>

            <div className="ml-auto inline-flex rounded-2xl border bg-slate-50 p-1">
              {(
                [
                  ["people", "People"],
                  ...(canSeeFinance
                    ? ([["finance", "Finance"]] as Array<[TabKey, string]>)
                    : []),
                ] as Array<[TabKey, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`rounded-2xl px-4 py-2 text-sm ${
                    tab === k
                      ? "bg-white border shadow-sm"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {errorMsg ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {/* KPI row */}
        {tab === "finance" && canSeeFinance ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FinanceKpiCard
              title="Income (This Month)"
              value={formatMoneyFromCents(financeKpi?.income_mtd ?? 0)}
            />
            <FinanceKpiCard
              title="Expense (This Month)"
              value={formatMoneyFromCents(financeKpi?.expense_mtd ?? 0)}
            />
            <FinanceKpiCard
              title="Net (This Month)"
              value={formatMoneyFromCents(financeKpi?.net_mtd ?? 0)}
            />

            <FinanceKpiCard
              title="Year-to-date"
              value={formatMoneyFromCents(financeKpi?.ytd ?? 0)}
              rightMeta={
                <select
                  className="h-7 rounded-lg border bg-white px-2 text-[11px] text-slate-700"
                  value={financeYtdMetric}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "income" || v === "expense" || v === "net")
                      setFinanceYtdMetric(v);
                  }}
                  title="YTD metric"
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="net">Net</option>
                </select>
              }
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PeopleKpiCard
              title="Total Active Members"
              big={peopleKpi?.total_active_all ?? 0}
              female={peopleKpi?.total_active_female ?? 0}
              male={peopleKpi?.total_active_male ?? 0}
              selected
              titleHint="Total active members"
            />

            <PeopleKpiCard
              title="New People (MTD)"
              big={peopleKpi?.new_mtd_all ?? 0}
              female={peopleKpi?.new_mtd_female ?? 0}
              male={peopleKpi?.new_mtd_male ?? 0}
              titleHint="Joined this month"
            />

            <PeopleKpiCard
              title="Avg Attendance (MTD)"
              big={(peopleKpi?.avg_att_mtd_all ?? 0).toFixed(1)}
              female={(peopleKpi?.avg_att_mtd_female ?? 0).toFixed(1)}
              male={(peopleKpi?.avg_att_mtd_male ?? 0).toFixed(1)}
              rightControl={
                <select
                  className="h-7 rounded-lg border bg-white px-2 text-[11px] text-slate-700"
                  value={peopleServiceScope || "all"}
                  onChange={(e) => setPeopleServiceScope(e.target.value)}
                  title="Attendance scope"
                >
                  <option value="all">All services</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              }
              titleHint="Average per session this month"
            />

            <PeopleKpiCard
              title="Avg Attendance by Age Group (MTD)"
              big={(peopleKpi?.avg_att_age_all ?? 0).toFixed(1)}
              female={(peopleKpi?.avg_att_age_female ?? 0).toFixed(1)}
              male={(peopleKpi?.avg_att_age_male ?? 0).toFixed(1)}
              rightControl={
                <select
                  className="h-7 rounded-lg border bg-white px-2 text-[11px] text-slate-700"
                  value={peopleAgeGroupFocus}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (
                      v === "all" ||
                      v === "1-12" ||
                      v === "13-17" ||
                      v === "18-35" ||
                      v === "36+"
                    ) {
                      setPeopleAgeGroupFocus(v === "all" ? "18-35" : v);
                    }
                  }}
                  title="Age group"
                >
                  {(["1-12", "13-17", "18-35", "36+"] as AgeGroup[]).map(
                    (ag) => (
                      <option key={ag} value={ag}>
                        {ag}
                      </option>
                    ),
                  )}
                </select>
              }
              titleHint="Average per session this month, filtered by age group"
            />
          </div>
        )}

        {/* Recent + Charts layout */}
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
              {/* <Pill>Shared</Pill> */}
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
                            {r.subtitle ?? "—"} •{" "}
                            {formatDateShort(r.happened_on)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Posted {formatDateTimeShort(r.posted_at)}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-semibold">
                            {rightValue}
                          </div>
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

          {/* Right: Charts */}
          <div
            className="rounded-3xl border bg-white p-5 lg:col-span-7 h-full flex flex-col"
            style={{
              minHeight: Math.max(CHART_MIN_HEIGHT, rightCardMinH ?? 0),
            }}
          >
            {tab === "finance" && canSeeFinance ? (
              <>
                {/* Finance chart 1 */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-semibold">
                      Income vs Expense
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex-1 rounded-2xl border bg-slate-50 p-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={financeChartData}>
                      <XAxis dataKey="monthLabel" />
                      <YAxis />
                      <Tooltip labelFormatter={tooltipLabelFormatter} />
                      <Legend />

                      <Line
                        type="monotone"
                        dataKey="income"
                        stroke={incomeColor}
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="expense"
                        stroke={expenseColor}
                        strokeWidth={2}
                        strokeDasharray="6 6"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Finance chart 2 (same width under) */}
                <div className="mt-5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">Top Categories</div>
                    <div className="text-xs text-slate-600">
                      {financeTopType === "income" ? "Income" : "Expense"} •{" "}
                      {financeTopPeriod === "month"
                        ? "This month"
                        : "This year"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-xl border bg-white px-3 text-sm"
                      value={financeTopPeriod}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "month" || v === "year")
                          setFinanceTopPeriod(v);
                      }}
                      title="Period"
                    >
                      <option value="month">This month</option>
                      <option value="year">This year</option>
                    </select>

                    <select
                      className="h-8 rounded-xl border bg-white px-3 text-sm"
                      value={financeTopType}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "income" || v === "expense")
                          setFinanceTopType(v);
                      }}
                      title="Type"
                    >
                      <option value="income">Income</option>
                      <option value="expense">Expense</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 h-[320px] rounded-2xl border bg-slate-50 p-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={financeTopBars}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis dataKey="label" />
  <YAxis />
  <Tooltip />
  <Bar dataKey="value" fill={incomeColor} radius={[10, 10, 0, 0]} />
</BarChart>

                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <>
                {/* People chart 1 */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-semibold">
                      Avg Attendance (Jan–Dec)
                    </div>
                    <div className="text-xs text-slate-600">
                      {effectiveServiceId
                        ? (services.find((s) => s.id === effectiveServiceId)
                            ?.name ?? "Selected service")
                        : "All services"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-xl border bg-white px-3 text-sm"
                      value={peopleServiceScope || "all"}
                      onChange={(e) => setPeopleServiceScope(e.target.value)}
                      title="Service"
                    >
                      <option value="all">All services</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex-1 rounded-2xl border bg-slate-50 p-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={peopleLineData}>
                      <XAxis dataKey="monthLabel" />
                      <YAxis />
                      <Tooltip labelFormatter={tooltipLabelFormatter} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="avg"
                        stroke={incomeColor}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* People chart 2 */}
                <div className="mt-5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">Demographics</div>
                    <div className="text-xs text-slate-600">
                      {peoplePeriod === "month" ? "This month" : "This year"} •{" "}
                      {peopleGenderFilter === "all"
                        ? "All genders"
                        : peopleGenderFilter}{" "}
                      •{" "}
                      {peopleAgeFilter === "all" ? "All ages" : peopleAgeFilter}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-xl border bg-white px-3 text-sm"
                      value={peoplePeriod}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "month" || v === "year") setPeoplePeriod(v);
                      }}
                      title="Period"
                    >
                      <option value="month">This month</option>
                      <option value="year">This year</option>
                    </select>

                    <select
                      className="h-8 rounded-xl border bg-white px-3 text-sm"
                      value={peopleGenderFilter}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "all" || v === "male" || v === "female")
                          setPeopleGenderFilter(v);
                      }}
                      title="Gender"
                    >
                      <option value="all">All</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>

                    <select
                      className="h-8 rounded-xl border bg-white px-3 text-sm"
                      value={peopleAgeFilter}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (
                          v === "all" ||
                          v === "1-12" ||
                          v === "13-17" ||
                          v === "18-35" ||
                          v === "36+"
                        ) {
                          setPeopleAgeFilter(v);
                        }
                      }}
                      title="Age group"
                    >
                      <option value="all">All ages</option>
                      <option value="1-12">1-12</option>
                      <option value="13-17">13-17</option>
                      <option value="18-35">18-35</option>
                      <option value="36+">36+</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 h-[320px] rounded-2xl border bg-slate-50 p-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={peopleDemoBars}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis dataKey="label" />
  <YAxis />
  <Tooltip />
  <Bar dataKey="value" fill={incomeColor} radius={[10, 10, 0, 0]} />
</BarChart>

                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** ========= Helpers used above ========= */

function avgAttendancePerSession(
  rows: AttendanceEntryRow[],
  gender: "all" | Gender,
): number {
  const filtered =
    gender === "all" ? rows : rows.filter((r) => r.gender === gender);

  // group by session_date (and service already filtered upstream)
  const byDate = new Map<string, number>();
  for (const r of filtered) {
    const k = r.session_date;
    byDate.set(k, (byDate.get(k) ?? 0) + (r.count ?? 0));
  }

  const sessions = byDate.size;
  if (sessions === 0) return 0;

  const total = Array.from(byDate.values()).reduce((s, x) => s + x, 0);
  return total / sessions;
}

function computeTopCategories(args: {
  topType: "income" | "expense";
  from: Date;
  toExclusive: Date;
  incomeRows: IncomeEntryRow[];
  expenseRows: ExpenseEntryRow[];
  incomeNames: Map<string, string>;
  expenseNames: Map<string, string>;
  limit: number;
}): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();

  if (args.topType === "income") {
    for (const r of args.incomeRows) {
      if (!inRangeDate(r.session_date, args.from, args.toExclusive)) continue;
      const id = r.income_category_id;
      map.set(id, (map.get(id) ?? 0) + (r.amount_cents ?? 0));
    }
    return Array.from(map.entries())
      .map(([id, cents]) => ({
        label: args.incomeNames.get(id) ?? "—",
        value: Math.round(centsToDollars(cents)),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, args.limit);
  }

  for (const r of args.expenseRows) {
    if (!inRangeDate(r.expense_date, args.from, args.toExclusive)) continue;
    const id = r.expense_category_id;
    map.set(id, (map.get(id) ?? 0) + (r.amount_cents ?? 0));
  }

  return Array.from(map.entries())
    .map(([id, cents]) => ({
      label: args.expenseNames.get(id) ?? "—",
      value: Math.round(centsToDollars(cents)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, args.limit);
}

async function loadRecentPublished(
  orgId: string,
  services: ServiceCategory[],
): Promise<RecentItem[]> {
  const serviceNameById = new Map<string, string>();
  for (const s of services) serviceNameById.set(s.id, s.name);

  // Pull latest published “headers” then compute totals for display.
  // For demo: grab a couple from each source and merge.
  const [incB, expB, attS] = await Promise.all([
    supabase
      .from("income_draft_batches")
      .select("id,org_id,status,session_date,posted_at")
      .eq("org_id", orgId)
      .eq("status", "published")
      .order("posted_at", { ascending: false })
      .limit(2),

    supabase
      .from("expense_draft_batches")
      .select("id,org_id,status,period_month,posted_at")
      .eq("org_id", orgId)
      .eq("status", "published")
      .order("posted_at", { ascending: false })
      .limit(2),

    supabase
      .from("attendance_sessions")
      .select("id,org_id,status,session_date,service_category_id,published_at")
      .eq("org_id", orgId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(2),
  ]);

  if (incB.error) throw incB.error;
  if (expB.error) throw expB.error;
  if (attS.error) throw attS.error;

  const incomeBatches = (incB.data ?? []) as IncomeBatchRow[];
  const expenseBatches = (expB.data ?? []) as ExpenseBatchRow[];
  const attendanceSessions = (attS.data ?? []) as AttendanceSessionRow[];

  // ---------- Attendance totals per session ----------
  const sessionIds = attendanceSessions.map((s) => s.id);
  const attendanceCountBySession = new Map<string, number>();

  if (sessionIds.length > 0) {
    const qSum = supabase
      .from("attendance_entries")
      .select("session_id,count")
      .eq("org_id", orgId)
      .in("session_id", sessionIds);

    const { data, error } = await qSum;
    if (error) throw error;

    const rows = (data ?? []) as Array<{ session_id: string; count: number }>;
    for (const r of rows) {
      attendanceCountBySession.set(
        r.session_id,
        (attendanceCountBySession.get(r.session_id) ?? 0) + (r.count ?? 0),
      );
    }
  }

  // ---------- Income totals (YTD-ish fallback) ----------
  // Your schema snippet didn’t show a batch_id on income_entries; if you DO have it,
  // swap to summing by batch_id for accuracy. For demo, we sum by session_date per batch.
  const incomeDates = Array.from(
    new Set(incomeBatches.map((b) => b.session_date)),
  );
  const incomeSumByDate = new Map<string, number>();

  if (incomeDates.length > 0) {
    const { data, error } = await supabase
      .from("income_entries")
      .select("session_date,amount_cents")
      .eq("org_id", orgId)
      .in("session_date", incomeDates);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      session_date: string;
      amount_cents: number;
    }>;
    for (const r of rows) {
      incomeSumByDate.set(
        r.session_date,
        (incomeSumByDate.get(r.session_date) ?? 0) + (r.amount_cents ?? 0),
      );
    }
  }

  // ---------- Expense totals (month-based fallback) ----------
  // Similar: if expense_entries has batch_id, use it. For demo we sum by month bucket.
  const expMonths = Array.from(
    new Set(expenseBatches.map((b) => b.period_month)),
  );
  const expenseSumByMonth = new Map<string, number>();

  if (expMonths.length > 0) {
    const { data, error } = await supabase
      .from("expense_entries")
      .select("period_month,amount_cents")
      .eq("org_id", orgId)
      .in("period_month", expMonths);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      period_month: string;
      amount_cents: number;
    }>;
    for (const r of rows) {
      expenseSumByMonth.set(
        r.period_month,
        (expenseSumByMonth.get(r.period_month) ?? 0) + (r.amount_cents ?? 0),
      );
    }
  }

  // ---------- Build RecentItem list ----------
  const items: RecentItem[] = [];

  for (const b of incomeBatches) {
    items.push({
      item_type: "income",
      posted_at: b.posted_at,
      happened_on: b.session_date,
      title: "Income batch",
      subtitle: formatDateShort(b.session_date),
      amount_cents: incomeSumByDate.get(b.session_date) ?? 0,
      attendance_count: null,
    });
  }

  for (const b of expenseBatches) {
    items.push({
      item_type: "expense",
      posted_at: b.posted_at,
      happened_on: b.period_month,
      title: "Expense batch",
      subtitle: `Period ${monthShort(b.period_month)} ${new Date(`${b.period_month}T00:00:00`).getFullYear()}`,
      amount_cents: expenseSumByMonth.get(b.period_month) ?? 0,
      attendance_count: null,
    });
  }

  for (const s of attendanceSessions) {
    const svcName = serviceNameById.get(s.service_category_id) ?? "Service";
    items.push({
      item_type: "attendance",
      posted_at: s.published_at,
      happened_on: s.session_date,
      title: "Attendance",
      subtitle: svcName,
      amount_cents: null,
      attendance_count: attendanceCountBySession.get(s.id) ?? 0,
    });
  }

  // Sort by posted_at (fallback to happened_on if null)
  items.sort((a, b) => {
    const aKey = a.posted_at ?? `${a.happened_on}T00:00:00Z`;
    const bKey = b.posted_at ?? `${b.happened_on}T00:00:00Z`;
    return bKey.localeCompare(aKey);
  });

  return items.slice(0, 4);
}
