"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildQuickReportPrintUrl,
  type QuickReportMode,
} from "@/lib/reports/quick/printUrl";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import {
  FINANCE_REPORT_WINDOW_DAYS,
  financeWindowStart,
} from "@/lib/reports/financeWindow";

type CategoryType = "income" | "expense" | "services";
type Cat = { id: string; name: string; type: CategoryType };
type ExpenseSort = "date" | "category";
type Role = "owner" | "admin" | "finance" | "viewer" | "member";

async function fetchCategories(
  orgId: string,
  type: CategoryType,
): Promise<Cat[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,type,status")
    .eq("org_id", orgId)
    .eq("status", "active")
    .eq("type", type)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Cat[];
}

type AttendanceView = "summary" | "detailed";
type Option = { id: string; name: string };

async function fetchMyRole(orgId: string): Promise<Role> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const userId = sessionResult.session?.user.id;
  if (!userId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle<{ role: Role }>();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not belong to this organization.");
  return data.role;
}

export default function QuickReportPage() {
  const router = useRouter();

  const [mode, setMode] = useState<QuickReportMode>("attendance");
  const [role, setRole] = useState<Role | null>(null);

  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    return toYmd(d);
  }, [today]);
  const defaultEnd = useMemo(() => toYmd(today), [today]);

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  // Separate selections per tab (default: all selected after load)
  const [incomeCategoryIds, setIncomeCategoryIds] = useState<string[]>([]);
  const [expenseCategoryIds, setExpenseCategoryIds] = useState<string[]>([]);
  const [incomeServiceIds, setIncomeServiceIds] = useState<string[]>([]);
  const [attendanceServiceIds, setAttendanceServiceIds] = useState<string[]>(
    [],
  );

  // Attendance radio stays as-is (do NOT default-check beyond "summary")
  const [attendanceView, setAttendanceView] =
    useState<AttendanceView>("summary");
  const [expenseSort, setExpenseSort] = useState<ExpenseSort>("date");

  const [serviceOptions, setServiceOptions] = useState<Option[]>([]);
  const [incomeCategoryOptions, setIncomeCategoryOptions] = useState<Option[]>(
    [],
  );
  const [expenseCategoryOptions, setExpenseCategoryOptions] = useState<
    Option[]
  >([]);
  const [loadErr, setLoadErr] = useState("");
  const canSeeFinancialReports =
    role === "owner" || role === "admin" || role === "finance";
  const financeCutoff = useMemo(() => financeWindowStart(today), [today]);

  useEffect(() => {
    if (role === "finance" && mode !== "attendance" && start < financeCutoff) {
      setStart(financeCutoff);
    }
  }, [financeCutoff, mode, role, start]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadErr("");
        const orgId = getActiveOrgId();
        if (!orgId) throw new Error("No active organization selected.");

        const [myRole, svcs, inc, exp] = await Promise.all([
          fetchMyRole(orgId),
          fetchCategories(orgId, "services"),
          fetchCategories(orgId, "income"),
          fetchCategories(orgId, "expense"),
        ]);

        if (!alive) return;

        setRole(myRole);
        setMode(
          myRole === "owner" || myRole === "admin" || myRole === "finance"
            ? "income"
            : "attendance",
        );

        const svcOpts = svcs.map((x) => ({ id: x.id, name: x.name }));
        const incOpts = inc.map((x) => ({ id: x.id, name: x.name }));
        const expOpts = exp.map((x) => ({ id: x.id, name: x.name }));

        setServiceOptions(svcOpts);
        setIncomeCategoryOptions(incOpts);
        setExpenseCategoryOptions(expOpts);

        // ✅ default-check EVERYTHING for checklists (income, expense, attendance)
        setIncomeServiceIds(svcOpts.map((x) => x.id));
        setAttendanceServiceIds(svcOpts.map((x) => x.id));
        setIncomeCategoryIds(incOpts.map((x) => x.id));
        setExpenseCategoryIds(expOpts.map((x) => x.id));
      } catch (e: unknown) {
        if (!alive) return;
        setLoadErr(
          e instanceof Error ? e.message : "Failed to load categories.",
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  function openPrintView() {
    if (!start || !end) return alert("Please select a start and end date.");
    if (end < start)
      return alert("End date cannot be earlier than start date.");
    if (mode !== "attendance" && !canSeeFinancialReports) {
      return alert("Income and expense reports require a finance, admin, or owner role.");
    }
    if (role === "finance" && mode !== "attendance" && start < financeCutoff) {
      return alert(
        `Finance reports cannot start before ${financeCutoff}.`,
      );
    }

    const service_ids =
      mode === "income"
        ? incomeServiceIds
        : mode === "attendance"
          ? attendanceServiceIds
          : undefined;

    const category_ids =
      mode === "income"
        ? incomeCategoryIds
        : mode === "expense"
          ? expenseCategoryIds
          : undefined;

    const url = buildQuickReportPrintUrl({
      mode,
      start,
      end,

      service_id: service_ids?.length ? service_ids : undefined,
      category_id: category_ids?.length ? category_ids : undefined,

      view: mode === "attendance" ? attendanceView : undefined,

      expense_sort: mode === "expense" ? expenseSort : undefined,
    });

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Quick report</div>
            <div className="text-sm text-slate-600">
              Choose a mode, set filters, then open the print view.
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
              <div className="text-xs font-semibold">FILTERS</div>
              <div className="mt-1 text-xs text-slate-600">
                These filters will be applied to the printable report.
              </div>
            </div>

            <div className="p-5">
              {loadErr ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {loadErr}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {canSeeFinancialReports ? (
                  <>
                    <ModePill
                      label="Income"
                      active={mode === "income"}
                      onClick={() => setMode("income")}
                    />
                    <ModePill
                      label="Expense"
                      active={mode === "expense"}
                      onClick={() => setMode("expense")}
                    />
                  </>
                ) : null}
                <ModePill
                  label="Attendance"
                  active={mode === "attendance"}
                  onClick={() => setMode("attendance")}
                />
              </div>

              {/* Expense: Dates | Categories */}
              {mode === "expense" ? (
                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                 <Card title="Date range">
                    <div className="grid grid-cols-1 gap-3">
                      <Field label="Start date">
                        <input
                          type="date"
                          min={role === "finance" ? financeCutoff : undefined}
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                          className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                      </Field>

                      <Field label="End date">
                        <input
                          type="date"
                          min={role === "finance" ? financeCutoff : undefined}
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                          className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                      </Field>
                    </div>
                  </Card>

                  <Card title="Expense categories">
                    <CheckList
                      options={expenseCategoryOptions}
                      selected={expenseCategoryIds}
                      onToggle={(id) =>
                        setExpenseCategoryIds(toggleId(expenseCategoryIds, id))
                      }
                      onSelectAll={() =>
                        setExpenseCategoryIds(
                          expenseCategoryOptions.map((x) => x.id),
                        )
                      }
                      onClear={() => setExpenseCategoryIds([])}
                      emptyText="No categories yet."
                    />
                  </Card>

                    <Card title="Sort">
                    <RadioGroup
                      name="expenseSort"
                      value={expenseSort}
                      onChange={(v) => setExpenseSort(v as ExpenseSort)}
                      options={[
                        { value: "date", label: "Date (earliest → latest)" },
                        { value: "category", label: "Category (A → Z)" },
                      ]}
                    />
                  </Card>
                </div>
              ) : (
                /* Income + Attendance: Dates | Services | Categories/Report Type */
                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <Card title="Date range">
                    <div className="grid grid-cols-1 gap-3">
                      <Field label="Start date">
                        <input
                          type="date"
                          min={
                            role === "finance" && mode === "income"
                              ? financeCutoff
                              : undefined
                          }
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                          className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                      </Field>

                      <Field label="End date">
                        <input
                          type="date"
                          min={
                            role === "finance" && mode === "income"
                              ? financeCutoff
                              : undefined
                          }
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                          className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                      </Field>
                    </div>
                  </Card>

                  <Card title="Services">
                    <CheckList
                      options={serviceOptions}
                      selected={
                        mode === "income"
                          ? incomeServiceIds
                          : attendanceServiceIds
                      }
                      onToggle={(id) =>
                        mode === "income"
                          ? setIncomeServiceIds(toggleId(incomeServiceIds, id))
                          : setAttendanceServiceIds(
                              toggleId(attendanceServiceIds, id),
                            )
                      }
                      onSelectAll={() =>
                        mode === "income"
                          ? setIncomeServiceIds(serviceOptions.map((x) => x.id))
                          : setAttendanceServiceIds(
                              serviceOptions.map((x) => x.id),
                            )
                      }
                      onClear={() =>
                        mode === "income"
                          ? setIncomeServiceIds([])
                          : setAttendanceServiceIds([])
                      }
                      emptyText="No services yet."
                    />
                  </Card>

                  <Card
                    title={
                      mode === "income" ? "Income categories" : "Report type"
                    }
                  >
                    {mode === "income" ? (
                      <CheckList
                        options={incomeCategoryOptions}
                        selected={incomeCategoryIds}
                        onToggle={(id) =>
                          setIncomeCategoryIds(toggleId(incomeCategoryIds, id))
                        }
                        onSelectAll={() =>
                          setIncomeCategoryIds(
                            incomeCategoryOptions.map((x) => x.id),
                          )
                        }
                        onClear={() => setIncomeCategoryIds([])}
                        emptyText="No categories yet."
                      />
                    ) : (
                      <RadioGroup
                        name="attendanceView"
                        value={attendanceView}
                        onChange={(v) => setAttendanceView(v as AttendanceView)}
                        options={[
                          { value: "summary", label: "Summary" },
                          { value: "detailed", label: "Detailed" },
                        ]}
                      />
                    )}
                  </Card>
                </div>
              )}

              <div className="mt-5">
                <button
                  onClick={openPrintView}
                  className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                  type="button"
                >
                  Open print view
                </button>

                <div className="mt-2 text-xs text-slate-500">
                  Note: Totals always include adjustments.
                </div>
                {role === "finance" && mode !== "attendance" ? (
                  <div className="mt-1 text-xs text-amber-700">
                    Finance reports are limited to the most recent{" "}
                    {FINANCE_REPORT_WINDOW_DAYS} days, beginning {financeCutoff}.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border bg-white p-4">
      <div className="text-xs font-semibold text-slate-600">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-600">{label}</div>
      {children}
    </div>
  );
}

function ModePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full border px-4 py-2 text-sm font-semibold",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
      type="button"
    >
      {label}
    </button>
  );
}

function CheckList({
  options,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  emptyText,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="text-xs font-semibold text-slate-600">
          {selected.length} selected
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSelectAll}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            type="button"
          >
            Select all
          </button>
          <span className="text-slate-300">|</span>
          <button
            onClick={onClear}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-auto border-t">
        {options.length === 0 ? (
          <div className="px-3 py-3 text-sm text-slate-500">{emptyText}</div>
        ) : (
          options.map((o) => {
            const isOn = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => onToggle(o.id)}
                  className="h-4 w-4 accent-slate-900"
                />
                <span className="text-sm text-slate-800">{o.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function RadioGroup({
  name,
  value,
  onChange,
  options,
  hint,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-3">
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-3"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 accent-slate-900"
            />
            <span className="text-sm text-slate-800">{o.label}</span>
          </label>
        ))}
      </div>
      {hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function toggleId(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
