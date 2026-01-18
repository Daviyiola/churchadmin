"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { buildIncomeStatementPrintUrl } from "@/lib/reports/income-statement/printUrl";

type CategoryType = "income" | "expense" | "services";
type Cat = { id: string; name: string; type: CategoryType };
type Option = { id: string; name: string };

async function fetchCategories(orgId: string, type: CategoryType): Promise<Cat[]> {
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

export default function IncomeStatementPage() {
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

  // selections (default: all selected after load)
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [incomeCategoryIds, setIncomeCategoryIds] = useState<string[]>([]);
  const [expenseCategoryIds, setExpenseCategoryIds] = useState<string[]>([]);

  // options
  const [serviceOptions, setServiceOptions] = useState<Option[]>([]);
  const [incomeCategoryOptions, setIncomeCategoryOptions] = useState<Option[]>([]);
  const [expenseCategoryOptions, setExpenseCategoryOptions] = useState<Option[]>([]);

  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadErr("");
        const orgId = getActiveOrgId();
        if (!orgId) throw new Error("No active organization selected.");

        const [svcs, inc, exp] = await Promise.all([
          fetchCategories(orgId, "services"),
          fetchCategories(orgId, "income"),
          fetchCategories(orgId, "expense"),
        ]);

        if (!alive) return;

        const svcOpts = svcs.map((x) => ({ id: x.id, name: x.name }));
        const incOpts = inc.map((x) => ({ id: x.id, name: x.name }));
        const expOpts = exp.map((x) => ({ id: x.id, name: x.name }));

        setServiceOptions(svcOpts);
        setIncomeCategoryOptions(incOpts);
        setExpenseCategoryOptions(expOpts);

        // check everything by default (on initial load)
        setServiceIds(svcOpts.map((x) => x.id));
        setIncomeCategoryIds(incOpts.map((x) => x.id));
        setExpenseCategoryIds(expOpts.map((x) => x.id));
      } catch (e: unknown) {
        if (!alive) return;
        setLoadErr(e instanceof Error ? e.message : "Failed to load categories.");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  function openPrintView() {
    if (!start || !end) return alert("Please select a start and end date.");
    if (end < start) return alert("End date cannot be earlier than start date.");

    const url = buildIncomeStatementPrintUrl({
      start_date: start,
      end_date: end,
      service_ids: serviceIds.length ? serviceIds : undefined,
      income_category_ids: incomeCategoryIds.length ? incomeCategoryIds : undefined,
      expense_category_ids: expenseCategoryIds.length ? expenseCategoryIds : undefined,
    });

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Income statement</div>
            <div className="text-sm text-slate-600">Set filters, then open the print view.</div>
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
                    Filters apply to the income statement totals.
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
              {loadErr ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {loadErr}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card title="Services (income only)">
                  <CheckList
                    options={serviceOptions}
                    selected={serviceIds}
                    onToggle={(id) => setServiceIds(toggleId(serviceIds, id))}
                    onSelectAll={() => setServiceIds(serviceOptions.map((x) => x.id))}
                    onClear={() => setServiceIds([])}
                    emptyText="No services yet."
                  />
                </Card>

                <Card title="Income categories">
                  <CheckList
                    options={incomeCategoryOptions}
                    selected={incomeCategoryIds}
                    onToggle={(id) => setIncomeCategoryIds(toggleId(incomeCategoryIds, id))}
                    onSelectAll={() =>
                      setIncomeCategoryIds(incomeCategoryOptions.map((x) => x.id))
                    }
                    onClear={() => setIncomeCategoryIds([])}
                    emptyText="No income categories yet."
                  />
                </Card>

                <Card title="Expense categories">
                  <CheckList
                    options={expenseCategoryOptions}
                    selected={expenseCategoryIds}
                    onToggle={(id) => setExpenseCategoryIds(toggleId(expenseCategoryIds, id))}
                    onSelectAll={() =>
                      setExpenseCategoryIds(expenseCategoryOptions.map((x) => x.id))
                    }
                    onClear={() => setExpenseCategoryIds([])}
                    emptyText="No expense categories yet."
                  />
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

                {/* <div className="mt-2 text-xs text-slate-500">
                  Tip: Leaving categories blank means “all categories”.
                </div> */}
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

function CheckList<TId extends string>({
  options,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  emptyText,
}: {
  options: { id: TId; name: string }[];
  selected: TId[];
  onToggle: (id: TId) => void;
  onSelectAll: () => void;
  onClear: () => void;
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="text-xs font-semibold text-slate-600">{selected.length} selected</div>
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

function toggleId<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
