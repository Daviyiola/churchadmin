"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import FloatingXScroll from "@/components/FloatingXScroll";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";
type CategoryType = "income" | "expense" | "services";
type PaymentMethod = "cash" | "cheque" | "online";
type ExpenseEntryType = "normal" | "adjustment" | "post_publication";

type CategoryRow = {
  id: string;
  name: string;
  type: CategoryType;
  status: "active" | "archived";
};

type PublishedBatch = {
  id: string;
  org_id: string;
  period_month: string; // YYYY-MM-01
  status: "published";
  created_by: string;
  created_at: string;
  updated_at: string;
  posted_by: string | null;
  posted_at: string | null;
};

type ExpenseEntry = {
  id: string;
  org_id: string;
  batch_id: string;

  period_month: string;

  expense_date: string;
  expense_category_id: string;
  description: string;
  vendor: string | null;

  payment_method: PaymentMethod;
  cheque_number: string | null;

  amount_cents: number;
  entry_type: ExpenseEntryType;
  note: string | null;

  posted_by: string;
  posted_at: string;
};

type ExpenseEntryEdit = {
  id: string;
  edited_by: string;
  edited_by_email: string | null;
  edited_at: string;
  field_name: "expense_category_id" | "amount_cents";
  old_value: string;
  new_value: string;
  reason: string | null;
};

function fmtDate(isoOrDate: string) {
  if (!isoOrDate) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString();
  }
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return isoOrDate;
  return dt.toLocaleDateString();
}

function fmtMonth(isoDate: string) {
  if (!isoDate) return "—";
  const [y, m] = isoDate.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, 1);
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatMoney(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
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
  return (data?.role as Role) ?? null;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {children}
    </span>
  );
}

function toISODateInput(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ExpensePublishedPage() {
  const orgId = getActiveOrgId();

  const [role, setRole] = useState<Role | null>(null);
  const isAdmin = role === "admin" || role === "owner";

  const [expenseCats, setExpenseCats] = useState<CategoryRow[]>([]);

  const [batches, setBatches] = useState<PublishedBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ===== Filters =====
  // Batch list filters
  const [monthFrom, setMonthFrom] = useState<string>(() => {
    // default last 6 months
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });
  const [monthTo, setMonthTo] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });

  // Entry filters (within selected batch)
  const [descQuery, setDescQuery] = useState("");
  const [expenseCatFilter, setExpenseCatFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">(
    "all",
  );
  const [entryTypeFilter, setEntryTypeFilter] = useState<
    "all" | "normal" | "adjustment" | "post_publication"
  >("all");

  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toISODateInput(d);
  });
  const [dateTo, setDateTo] = useState<string>(() =>
    toISODateInput(new Date()),
  );

  // Negative adjustment modal (admin only)
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjExpenseDate, setAdjExpenseDate] = useState<string>(() =>
    toISODateInput(new Date()),
  );
  const [adjExpenseCategoryId, setAdjExpenseCategoryId] = useState<string>("");
  const [adjDescription, setAdjDescription] = useState<string>("");
  const [adjVendor, setAdjVendor] = useState<string>("");
  const [adjPaymentMethod, setAdjPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [adjChequeNumber, setAdjChequeNumber] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjErr, setAdjErr] = useState("");
  const [postingAdj, setPostingAdj] = useState(false);

  const expenseCatNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of expenseCats) map.set(c.id, c.name);
    return map;
  }, [expenseCats]);

  const [editOpen, setEditOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string>("");
  const [editExpenseCategoryId, setEditExpenseCategoryId] =
    useState<string>("");
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editErr, setEditErr] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [editLog, setEditLog] = useState<ExpenseEntryEdit[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const loadAll = async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    const myRole = await getMyRoleForOrg(orgId);
    setRole(myRole);

    const [catsRes, batchesRes] = await Promise.all([
      supabase
        .from("categories")
        .select("id,name,type,status")
        .eq("org_id", orgId)
        .eq("status", "active")
        .eq("type", "expense")
        .order("name", { ascending: true }),
      supabase
        .from("expense_draft_batches")
        .select(
          "id,org_id,period_month,status,created_by,created_at,updated_at,posted_by,posted_at",
        )
        .eq("org_id", orgId)
        .eq("status", "published")
        .order("posted_at", { ascending: false }),
    ]);

    if (catsRes.error) {
      setErr(catsRes.error.message);
      setLoading(false);
      return;
    }
    if (batchesRes.error) {
      setErr(batchesRes.error.message);
      setLoading(false);
      return;
    }

    setExpenseCats((catsRes.data ?? []) as CategoryRow[]);

    const bs = (batchesRes.data ?? []) as PublishedBatch[];
    setBatches(bs);
    if (!selectedBatchId && bs.length > 0) setSelectedBatchId(bs[0].id);

    setLoading(false);
  };

  const loadEntries = async (batchId: string) => {
    if (!orgId) return;

    const res = await supabase
      .from("expense_entries")
      .select(
        "id,org_id,batch_id,period_month,expense_date,expense_category_id,description,vendor,payment_method,cheque_number,amount_cents,entry_type,note,posted_by,posted_at",
      )
      .eq("org_id", orgId)
      .eq("batch_id", batchId)
      .order("expense_date", { ascending: true })
      .order("posted_at", { ascending: true });

    if (res.error) {
      setErr(res.error.message);
      setEntries([]);
      return;
    }

    setEntries((res.data ?? []) as ExpenseEntry[]);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (!adjOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [adjOpen]);

  useEffect(() => {
    if (selectedBatchId) loadEntries(selectedBatchId);
    else setEntries([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  async function loadExpenseEditLog(entryId: string) {
    if (!orgId) return;
    setLoadingLog(true);

    const { data, error } = await supabase
      .from("expense_entry_edits")
      .select(
        "id,edited_by,edited_by_email,edited_at,field_name,old_value,new_value,reason",
      )
      .eq("org_id", orgId)
      .eq("entry_id", entryId)
      .order("edited_at", { ascending: false });

    setLoadingLog(false);
    if (error) {
      setEditLog([]);
      return;
    }
    setEditLog((data ?? []) as ExpenseEntryEdit[]);
  }

  function prettyExpenseLogValue(h: ExpenseEntryEdit): [string, string] {
    if (h.field_name === "expense_category_id") {
      const oldName = expenseCatNameById.get(h.old_value) ?? h.old_value;
      const newName = expenseCatNameById.get(h.new_value) ?? h.new_value;
      return [oldName, newName];
    }

    const oldCents = Number(h.old_value);
    const newCents = Number(h.new_value);

    const oldStr = Number.isFinite(oldCents)
      ? formatMoney(oldCents)
      : h.old_value;
    const newStr = Number.isFinite(newCents)
      ? formatMoney(newCents)
      : h.new_value;
    return [oldStr, newStr];
  }

  function openEditEntry(e: ExpenseEntry) {
    if (!isAdmin) {
      setErr("Admin only.");
      return;
    }

    setShowHistory(false);
    setEditErr("");
    setEditEntryId(e.id);
    setEditExpenseCategoryId(e.expense_category_id);
    setEditAmount((e.amount_cents / 100).toFixed(2));
    setEditReason("");

    setEditOpen(true);
    loadExpenseEditLog(e.id);
  }

  async function saveEditedExpense() {
    if (!orgId) return;
    if (!isAdmin) return;
    if (!editEntryId) return;

    if (!editExpenseCategoryId) return setEditErr("Select a category.");

    const cents = parseMoneyToCents(editAmount);
    if (cents === null || cents <= 0)
      return setEditErr("Enter a valid amount > 0.");

    if (editReason.trim() === "") return setEditErr("Enter a reason.");
      
    setSavingEdit(true);
    setEditErr("");

    const { data, error } = await supabase.rpc("edit_expense_entry_logged", {
      p_org_id: orgId,
      p_entry_id: editEntryId,
      p_expense_category_id: editExpenseCategoryId,
      p_amount_cents: cents,
      p_reason: editReason.trim() || null,
    });

    if (error) {
      setEditErr(error.message);
      setSavingEdit(false);
      return;
    }

    type EditExpenseResult = {
      id: string;
      expense_category_id: string;
      amount_cents: number;
      entry_type: ExpenseEntryType;
    };

    const row = (Array.isArray(data) ? data[0] : data) as EditExpenseResult;

    setEntries((prev) =>
      prev.map((x) =>
        x.id === editEntryId
          ? {
              ...x,
              expense_category_id: row.expense_category_id,
              amount_cents: row.amount_cents,
              entry_type: row.entry_type,
            }
          : x,
      ),
    );

    setSavingEdit(false);
    setEditOpen(false);

    // refresh truth + log
    if (selectedBatchId) await loadEntries(selectedBatchId);
  }

  // ===== Apply filters =====

  const filteredBatches = useMemo(() => {
    const fromOk = monthFrom && /^\d{4}-\d{2}$/.test(monthFrom);
    const toOk = monthTo && /^\d{4}-\d{2}$/.test(monthTo);

    const fromKey = fromOk ? monthFrom.replace("-", "") : null; // YYYYMM
    const toKey = toOk ? monthTo.replace("-", "") : null;

    return batches.filter((b) => {
      const [y, m] = b.period_month.split("-").map(Number);
      const key = `${y}${String(m).padStart(2, "0")}`;

      if (fromKey && key < fromKey) return false;
      if (toKey && key > toKey) return false;
      return true;
    });
  }, [batches, monthFrom, monthTo]);

  // keep selection valid when batch filters change
  useEffect(() => {
    if (!selectedBatchId) return;
    const stillVisible = filteredBatches.some((b) => b.id === selectedBatchId);
    if (stillVisible) return;

    if (filteredBatches.length > 0) setSelectedBatchId(filteredBatches[0].id);
    else setSelectedBatchId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFrom, monthTo, batches]);

  const filteredEntries = useMemo(() => {
    const q = descQuery.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;

    return entries.filter((e) => {
      if (
        expenseCatFilter !== "all" &&
        e.expense_category_id !== expenseCatFilter
      )
        return false;
      if (methodFilter !== "all" && e.payment_method !== methodFilter)
        return false;
      if (entryTypeFilter !== "all" && e.entry_type !== entryTypeFilter)
        return false;

      if (from || to) {
        const d = new Date(e.expense_date + "T12:00:00");
        if (from && d < from) return false;
        if (to && d > to) return false;
      }

      if (q) {
        const hay = `${e.description ?? ""} ${e.vendor ?? ""} ${
          e.note ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    entries,
    expenseCatFilter,
    methodFilter,
    entryTypeFilter,
    dateFrom,
    dateTo,
    descQuery,
  ]);

  const filteredTotalCents = useMemo(
    () => filteredEntries.reduce((s, e) => s + e.amount_cents, 0),
    [filteredEntries],
  );

  const openAdjustment = () => {
    if (!selectedBatch) return;
    if (!isAdmin) {
      setErr("Admin only.");
      return;
    }
    setAdjExpenseDate(toISODateInput(new Date()));
    setAdjExpenseCategoryId(expenseCats[0]?.id ?? "");
    setAdjDescription("");
    setAdjVendor("");
    setAdjPaymentMethod("cash");
    setAdjChequeNumber("");
    setAdjAmount("");
    setAdjNote("");
    setAdjErr("");
    setAdjOpen(true);
  };

  const postAdjustment = async () => {
    if (!selectedBatch) return;
    if (!isAdmin) return;

    if (!adjExpenseDate) return setAdjErr("Date is required.");
    if (!adjExpenseCategoryId)
      return setAdjErr("Expense category is required.");
    if (!adjDescription.trim()) return setAdjErr("Description is required.");

    if (adjPaymentMethod === "cheque" && adjChequeNumber.trim().length === 0) {
      return setAdjErr("Cheque number is required for cheque.");
    }

    const cents = parseMoneyToCents(adjAmount);
    if (cents === null || cents <= 0) {
      setAdjErr("Amount must be greater than zero.");
      return;
    }

    const vendor = adjVendor?.trim() ? adjVendor.trim() : null;
    const note = adjNote?.trim() ? adjNote.trim() : null;
    const cheque =
      adjPaymentMethod === "cheque" ? adjChequeNumber?.trim() || null : null;

    const { error } = await supabase.rpc("add_expense_post_publication", {
      p_org_id: orgId,
      p_batch_id: selectedBatch.id,
      p_expense_date: adjExpenseDate,
      p_expense_category_id: adjExpenseCategoryId,
      p_description: adjDescription.trim(),
      p_payment_method: adjPaymentMethod,
      p_amount_cents: cents,
      p_vendor: vendor,
      p_cheque_number: cheque,
      p_note: note,
    });

    if (error) {
      setAdjErr(error.message);
      setPostingAdj(false);
      return;
    }

    setPostingAdj(false);
    setAdjOpen(false);
    await loadEntries(selectedBatch.id);
  };

  const clearEntryFilters = () => {
    setDescQuery("");
    setExpenseCatFilter("all");
    setMethodFilter("all");
    setEntryTypeFilter("all");
    setDateFrom(
      toISODateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );
    setDateTo(toISODateInput(new Date()));
  };

  if (!orgId)
    return (
      <div className="p-6 text-slate-700">No active organization selected.</div>
    );
  if (loading) return <div className="p-10 text-slate-700">Loading…</div>;

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Expense • Published</div>
            <div className="text-sm text-slate-600">
              Immutable entries (includes adjustments)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/app/expense"
              className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
            >
              Back to drafts
            </a>
          </div>
        </div>

        {err ? (
          <div className="px-6 pb-5">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          </div>
        ) : null}
      </div>

      <div className="p-6">
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: Published batches + filters */}
          <div className="rounded-3xl border p-5 lg:col-span-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Published Batches</div>
                <div className="mt-1 text-xs text-slate-600">
                  {filteredBatches.length} shown
                </div>
              </div>
              <Pill>v1</Pill>
            </div>

            {/* Batch filters */}
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    From (month)
                  </div>
                  <input
                    type="month"
                    className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={monthFrom}
                    onChange={(e) => setMonthFrom(e.target.value)}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    To (month)
                  </div>
                  <input
                    type="month"
                    className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={monthTo}
                    onChange={(e) => setMonthTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {filteredBatches.length === 0 ? (
                <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                  No published batches match your filters.
                </div>
              ) : (
                filteredBatches.map((b) => {
                  const active = b.id === selectedBatchId;
                  const label = `Expense Entry — ${fmtMonth(b.period_month)}`;

                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBatchId(b.id)}
                      className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${
                        active ? "bg-primary text-white" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{label}</div>
                          <div
                            className={`font-medium truncate ${
                              active ? "text-white" : ""
                            }`}
                          >
                            Posted {b.posted_at ? fmtDate(b.posted_at) : "—"}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <Pill>Published</Pill>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Entries + filters */}
          <div className="rounded-3xl border p-5 lg:col-span-8">
            {!selectedBatch ? (
              <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                Select a published batch.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">
                      Expense Entry — {fmtMonth(selectedBatch.period_month)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {filteredEntries.length} entries shown • Total{" "}
                      {formatMoney(filteredTotalCents)}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={clearEntryFilters}
                      title="Clear entry filters"
                    >
                      Clear filters
                    </button>

                    <button
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                        !isAdmin
                          ? "bg-slate-300"
                          : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={!isAdmin}
                      onClick={openAdjustment}
                      title={
                        !isAdmin ? "Admin only" : "Add a post-publication entry"
                      }
                    >
                      Add post publication (+)
                    </button>
                  </div>
                </div>

                {/* Entry filters */}
                <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Search
                      </div>
                      <input
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={descQuery}
                        onChange={(e) => setDescQuery(e.target.value)}
                        placeholder="Description, vendor, note…"
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Expense category
                      </div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={expenseCatFilter}
                        onChange={(e) => setExpenseCatFilter(e.target.value)}
                      >
                        <option value="all">All categories</option>
                        {expenseCats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Method
                      </div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={methodFilter}
                        onChange={(e) =>
                          setMethodFilter(
                            e.target.value as PaymentMethod | "all",
                          )
                        }
                      >
                        <option value="all">All methods</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="online">Online</option>
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Entry type
                      </div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={entryTypeFilter}
                        onChange={(e) =>
                          setEntryTypeFilter(
                            e.target.value as "all" | "normal" | "adjustment",
                          )
                        }
                      >
                        <option value="all">All</option>
                        <option value="normal">Normal</option>
                        <option value="adjustment">Adjustment</option>
                        <option value="post_publication">
                          Post-publication
                        </option>
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        From (date)
                      </div>
                      <input
                        type="date"
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        To (date)
                      </div>
                      <input
                        type="date"
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                    <FloatingXScroll forceShow={true} onlyWhenOverflow={false}>
                    <div className="min-w-[1300px]">
                      <div className="grid grid-cols-13 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100 rounded-t-3xl">
                        <div className="col-span-2">Date</div>
                        <div className="col-span-2">Description</div>
                        <div className="col-span-2">Category</div>
                        <div className="col-span-1">Amount</div>
                        <div className="col-span-2">Vendor</div>
                        <div className="col-span-1">Method</div>
                        <div className="col-span-1">Cheque #</div>
                        <div className="col-span-2 text-right">Action</div>
                      </div>

                      {filteredEntries.length === 0 ? (
                        <div className="p-6 text-sm text-slate-600">
                          No entries match your filters.
                        </div>
                      ) : (
                        <div className="divide-y">
                          {filteredEntries.map((e) => (
                            <div
                              key={e.id}
                              className="grid grid-cols-13 items-center px-5 py-4 text-sm"
                            >
                              <div className="col-span-2 text-slate-700">
                                {fmtDate(e.expense_date)}
                              </div>

                              <div className="col-span-2">
                                <div className="font-medium text-slate-900 line-clamp-1">
                                  {e.description}
                                </div>
                                {e.note ? (
                                  <div className="text-xs text-slate-500 truncate">
                                    {e.note}
                                  </div>
                                ) : null}
                              </div>

                              <div className="col-span-2">
                                <div className="font-semibold">
                                  {expenseCatNameById.get(
                                    e.expense_category_id,
                                  ) ?? "—"}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {e.entry_type}
                                </div>
                              </div>

                              <div className="col-span-1 font-semibold">
                                {formatMoney(e.amount_cents)}
                              </div>

                              <div className="col-span-2 text-slate-700">
                                {e.vendor ?? "—"}
                              </div>

                              <div className="col-span-1 text-slate-700">
                                {e.payment_method}
                              </div>

                              <div className="col-span-1 text-slate-700">
                                {e.payment_method === "cheque"
                                  ? (e.cheque_number ?? "—")
                                  : "—"}
                              </div>

                              <div className="col-span-2 flex justify-end">
                                <button
                                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                                    !isAdmin
                                      ? "bg-slate-100 text-slate-400"
                                      : "hover:bg-slate-50"
                                  }`}
                                  disabled={!isAdmin}
                                  onClick={() => openEditEntry(e)}
                                  title={
                                    !isAdmin
                                      ? "Admin only"
                                      : "Edit category/amount"
                                  }
                                >
                                  Edit
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                   </FloatingXScroll>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl max-h-[90vh] rounded-3xl bg-white shadow-xl flex flex-col overflow-hidden">
            <div className="border-b px-6 py-4 shrink-0">
              <div className="text-sm font-semibold">Edit expense entry</div>
              <div className="text-xs text-slate-600">
                Posts a correcting entry. Admin only.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4 overflow-y-auto">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Expense category *
                </div>
                <select
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={editExpenseCategoryId}
                  onChange={(e) => {
                    setEditExpenseCategoryId(e.target.value);
                    setEditErr("");
                  }}
                >
                  <option value="">Select…</option>
                  {expenseCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Amount *
                </div>
                <div className="flex">
                  <div className="flex items-center rounded-l-2xl border border-r-0 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
                    $
                  </div>
                  <input
                    className="w-full rounded-r-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={editAmount}
                    onChange={(e) => {
                      setEditAmount(e.target.value);
                      setEditErr("");
                    }}
                    placeholder="e.g., 120.00"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Reason *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g., miscategorized + recount"
                />
              </div>

              {editErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editErr}
                </div>
              ) : null}

              <div className="rounded-2xl border bg-slate-50">
                <button
                  type="button"
                  className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold"
                  onClick={() => setShowHistory((v) => !v)}
                >
                  <span>Revision history</span>
                  <span className="text-xs text-slate-600">
                    {editLog.length
                      ? `${editLog.length} change${editLog.length === 1 ? "" : "s"}`
                      : "None"}
                  </span>
                </button>

                {showHistory ? (
                  <div className="border-t px-4 py-3">
                    {loadingLog ? (
                      <div className="text-sm text-slate-600">
                        Loading history…
                      </div>
                    ) : editLog.length === 0 ? (
                      <div className="text-sm text-slate-600">
                        No revision history.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {editLog.map((h) => {
                          const [oldV, newV] = prettyExpenseLogValue(h);
                          return (
                            <div
                              key={h.id}
                              className="rounded-xl border bg-white p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-xs font-semibold text-slate-700">
                                    {fmtDate(h.edited_at)}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {"Changed by: " +
                                      (h.edited_by_email ?? "Unknown editor")}
                                  </div>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {h.field_name === "expense_category_id"
                                    ? "Category"
                                    : "Amount"}
                                </div>
                              </div>

                              <div className="mt-1 text-sm text-slate-800">
                                <span className="font-semibold">{oldV}</span>
                                <span className="mx-2 text-slate-800">
                                  changed to
                                </span>
                                <span className="font-semibold">{newV}</span>
                              </div>

                              {h.reason ? (
                                <div className="mt-1 text-xs text-slate-600">
                                  Reason: {h.reason}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4 shrink-0">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setEditOpen(false)}
                disabled={savingEdit}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  savingEdit ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                onClick={saveEditedExpense}
                disabled={savingEdit}
              >
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Post publication modal */}
      {adjOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] rounded-3xl bg-white shadow-xl flex flex-col overflow-hidden">
            <div className="border-b px-6 py-4 shrink-0">
              <div className="text-sm font-semibold">Post-publication entry</div>
              <div className="text-xs text-slate-600">
                Adds a missed entry into an already-published batch. Logged.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4 overflow-y-auto">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This entry will be marked <span className="font-semibold">Post-publication</span>{" "}
                and shown in reports under this service date, but it was added after publishing.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Date *
                  </div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={adjExpenseDate}
                    onChange={(e) => {
                      setAdjExpenseDate(e.target.value);
                      setAdjErr("");
                    }}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Expense category *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={adjExpenseCategoryId}
                    onChange={(e) => {
                      setAdjExpenseCategoryId(e.target.value);
                      setAdjErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    {expenseCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Description *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={adjDescription}
                  onChange={(e) => {
                    setAdjDescription(e.target.value);
                    setAdjErr("");
                  }}
                  placeholder="e.g., Corrected duplicated charge"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Vendor (optional)
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={adjVendor}
                  onChange={(e) => {
                    setAdjVendor(e.target.value);
                    setAdjErr("");
                  }}
                  placeholder="e.g., Shell, Staples"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Method *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={adjPaymentMethod}
                    onChange={(e) => {
                      setAdjPaymentMethod(e.target.value as PaymentMethod);
                      setAdjErr("");
                    }}
                  >
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="online">Online</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Cheque number {adjPaymentMethod === "cheque" ? "*" : ""}
                  </div>
                  <input
                    className={`w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 ${
                      adjPaymentMethod !== "cheque"
                        ? "bg-slate-50 text-slate-500"
                        : ""
                    }`}
                    value={adjChequeNumber}
                    onChange={(e) => {
                      setAdjChequeNumber(e.target.value);
                      setAdjErr("");
                    }}
                    disabled={adjPaymentMethod !== "cheque"}
                    placeholder={
                      adjPaymentMethod === "cheque" ? "e.g., 103849" : "—"
                    }
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Amount *
                </div>
                <div className="flex">
                  <div className="flex items-center rounded-l-2xl border border-r-0 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
                    $
                  </div>
                  <input
                    className="w-full rounded-r-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={adjAmount}
                    onChange={(e) => {
                      setAdjAmount(e.target.value);
                      setAdjErr("");
                    }}
                    placeholder="e.g., 90.00"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Reason 
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  placeholder="e.g., Added missed entry"
                />
              </div>

              {adjErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {adjErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setAdjOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  postingAdj ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={postingAdj}
                onClick={postAdjustment}
              >
                {postingAdj ? "Posting…" : "Post entry"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
