"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { useRouter } from "next/navigation";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";
type CategoryType = "income" | "expense" | "services";
type PaymentMethod = "cash" | "cheque" | "online";

type CategoryRow = {
  id: string;
  name: string;
  type: CategoryType;
  status: "active" | "archived";
};

type DraftBatch = {
  id: string;
  org_id: string;
  period_month: string; // YYYY-MM-DD (we store 1st of month)
  status: "draft" | "published";
  created_by: string;
  created_at: string;
  updated_at: string;
  posted_by: string | null;
  posted_at: string | null;
};

type DraftItem = {
  id: string;
  org_id: string;
  batch_id: string;
  expense_date: string; // YYYY-MM-DD
  expense_category_id: string;
  description: string;
  vendor: string | null;
  payment_method: PaymentMethod;
  cheque_number: string | null;
  amount_cents: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function fmtDate(isoOrDate: string) {
  if (!isoOrDate) return "—";

  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.split("-").map(Number);
    const local = new Date(y, m - 1, d);
    return local.toLocaleDateString();
  }

  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return isoOrDate;
  return dt.toLocaleDateString();
}

function fmtMonth(isoDate: string) {
  // isoDate is YYYY-MM-01
  if (!isoDate) return "—";
  const [y, m] = isoDate.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, 1);
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatMoney(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  return `${sign}$${dollars}`;
}

function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

function firstDayOfMonthISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function Toast({ show, text }: { show: boolean; text: string }) {
  return (
    <div
      className={`fixed right-6 top-6 z-[9999] transition-all duration-300 ${
        show ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="rounded-2xl border bg-white px-4 py-3 text-sm shadow-lg">{text}</div>
    </div>
  );
}

export default function ExpenseDraftPage() {
  const orgId = getActiveOrgId();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const isFinance = role === "finance" || role === "admin" || role === "owner";

  // reference
  const [expenseCats, setExpenseCats] = useState<CategoryRow[]>([]);

  // batches
  const [batches, setBatches] = useState<DraftBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // items
  const [items, setItems] = useState<DraftItem[]>([]);

  // ui state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("");

  // create batch modal
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMonth, setBatchMonth] = useState<string>(""); // YYYY-MM

  // add/edit item modal
  const [itemOpen, setItemOpen] = useState(false);
  const [itemMode, setItemMode] = useState<"create" | "edit">("create");
  const [editItemId, setEditItemId] = useState<string | null>(null);

  const [expenseDate, setExpenseDate] = useState<string>("");
  const [expenseCategoryId, setExpenseCategoryId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [chequeNumber, setChequeNumber] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [vendor, setVendor] = useState<string>("");

  const [savingItem, setSavingItem] = useState(false);
  const [itemErr, setItemErr] = useState("");

  const [publishing, setPublishing] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  const draftCount = useMemo(() => batches.length, [batches]);

  const batchSummary = useMemo(() => {
    const cents = items.reduce((sum, it) => sum + it.amount_cents, 0);
    return { count: items.length, cents };
  }, [items]);

  const expenseCatNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of expenseCats) map.set(c.id, c.name);
    return map;
  }, [expenseCats]);

  const showToast = (t: string) => {
    setToastText(t);
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
  };

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
        .select("id,org_id,period_month,status,created_by,created_at,updated_at,posted_by,posted_at")
        .eq("org_id", orgId)
        .eq("status", "draft")
        .order("updated_at", { ascending: false }),
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
    const bs = (batchesRes.data ?? []) as DraftBatch[];
    setBatches(bs);

    if (!selectedBatchId && bs.length > 0) setSelectedBatchId(bs[0].id);

    setLoading(false);
  };

  const loadItems = async (batchId: string) => {
    if (!orgId) return;

    const res = await supabase
      .from("expense_draft_items")
      .select(
        "id,org_id,batch_id,expense_date,expense_category_id,description,vendor,payment_method,cheque_number,amount_cents,created_by,created_at,updated_at"
      )
      .eq("org_id", orgId)
      .eq("batch_id", batchId)
      .order("expense_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (res.error) {
      setErr(res.error.message);
      setItems([]);
      return;
    }

    setItems((res.data ?? []) as DraftItem[]);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (selectedBatchId) loadItems(selectedBatchId);
    else setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  // ====== Batch create/delete ======
  const openCreateBatch = () => {
    setErr("");
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    setBatchMonth(`${yyyy}-${mm}`); // YYYY-MM
    setBatchOpen(true);
  };

  const createBatch = async () => {
    if (!orgId) return;

    if (draftCount >= 10) {
      setErr("Max 10 draft batches reached. Publish or delete one.");
      setBatchOpen(false);
      return;
    }

    if (!batchMonth || !/^\d{4}-\d{2}$/.test(batchMonth)) {
      setErr("Select a month.");
      return;
    }

    const periodMonth = `${batchMonth}-01`;

    const { error } = await supabase.from("expense_draft_batches").insert({
      org_id: orgId,
      period_month: periodMonth,
      status: "draft",
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setBatchOpen(false);
    await loadAll();
    showToast("Draft batch created ");
  };

  const deleteDraftBatch = async (batchId: string) => {
    if (!isFinance) {
      setErr("Only finance/admin can delete drafts.");
      return;
    }

    const ok = confirm("Delete this draft batch? This will remove all its draft items.");
    if (!ok) return;

    const { error } = await supabase.from("expense_draft_batches").delete().eq("id", batchId);
    if (error) {
      setErr(error.message);
      return;
    }

    if (selectedBatchId === batchId) setSelectedBatchId(null);

    await loadAll();
    showToast("Draft deleted ");
  };

  // ====== Item add/edit/delete ======
  const resetItemForm = () => {
    setExpenseDate(todayISO());
    setExpenseCategoryId(expenseCats[0]?.id ?? "");
    setPaymentMethod("cash");
    setChequeNumber("");
    setAmount("");
    setDescription("");
    setVendor("");
    setItemErr("");
    setEditItemId(null);
  };

  const openAddItem = () => {
    if (!selectedBatch) {
      setErr("Select a draft batch to add items.");
      return;
    }
    if (selectedBatch.status !== "draft") {
      setErr("Select a draft batch to add items.");
      return;
    }
    resetItemForm();
    setItemMode("create");
    setItemOpen(true);
    window.setTimeout(() => amountRef.current?.focus(), 50);
  };

  const openEditItem = (it: DraftItem) => {
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    setItemMode("edit");
    setEditItemId(it.id);
    setExpenseDate(it.expense_date);
    setExpenseCategoryId(it.expense_category_id);
    setPaymentMethod(it.payment_method);
    setChequeNumber(it.cheque_number ?? "");
    setAmount((it.amount_cents / 100).toFixed(2));
    setDescription(it.description ?? "");
    setVendor(it.vendor ?? "");
    setItemErr("");
    setItemOpen(true);
    window.setTimeout(() => amountRef.current?.focus(), 50);
  };

  const saveItem = async () => {
    if (!orgId || !selectedBatchId) return;

    if (!expenseDate) {
      setItemErr("Date is required.");
      return;
    }
    if (!expenseCategoryId) {
      setItemErr("Expense category is required.");
      return;
    }
    if (!description.trim()) {
      setItemErr("Description is required.");
      return;
    }
    if (paymentMethod === "cheque" && chequeNumber.trim().length === 0) {
      setItemErr("Cheque number is required for cheque payments.");
      return;
    }

    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      setItemErr("Amount must be greater than zero.");
      return;
    }

    setSavingItem(true);

    if (itemMode === "create") {
      const { error } = await supabase.from("expense_draft_items").insert({
        org_id: orgId,
        batch_id: selectedBatchId,
        expense_date: expenseDate,
        expense_category_id: expenseCategoryId,
        description: description.trim(),
        vendor: vendor.trim() ? vendor.trim() : null,
        payment_method: paymentMethod,
        cheque_number: paymentMethod === "cheque" ? chequeNumber.trim() : null,
        amount_cents: cents,
      });

      if (error) {
        setItemErr(error.message);
        setSavingItem(false);
        return;
      }

      // IMPORTANT: keep modal open + retain all inputs except amount (per your UX request)
      setSavingItem(false);
      setAmount("");
      setItemErr("");
      showToast("Draft expense added");
      await loadAll();
      await loadItems(selectedBatchId);
      window.setTimeout(() => amountRef.current?.focus(), 50);
      return;
    }

    // edit mode
    if (!editItemId) {
      setSavingItem(false);
      return;
    }

    const { error } = await supabase
      .from("expense_draft_items")
      .update({
        expense_date: expenseDate,
        expense_category_id: expenseCategoryId,
        description: description.trim(),
        vendor: vendor.trim() ? vendor.trim() : null,
        payment_method: paymentMethod,
        cheque_number: paymentMethod === "cheque" ? chequeNumber.trim() : null,
        amount_cents: cents,
      })
      .eq("id", editItemId);

    if (error) {
      setItemErr(error.message);
      setSavingItem(false);
      return;
    }

    setSavingItem(false);
    setItemOpen(false);
    await loadAll();
    await loadItems(selectedBatchId);
    showToast("Draft expense updated ");
  };

  const removeItem = async (id: string) => {
    if (!selectedBatch || selectedBatch.status !== "draft") return;
    const ok = confirm("Remove this draft expense?");
    if (!ok) return;

    const { error } = await supabase.from("expense_draft_items").delete().eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }

    await loadAll();
    await loadItems(selectedBatch.id);
    showToast("Removed ");
  };

  // ====== Publish ======
  const publishBatch = async () => {
    if (!selectedBatch) return;
    if (!isFinance) {
      setErr("Only finance/admin can publish.");
      return;
    }
    if (selectedBatch.status !== "draft") return;

    if (items.length === 0) {
      setErr("Add at least one draft item before publishing.");
      return;
    }

    const ok = confirm("Publish this draft? Published entries are immutable.");
    if (!ok) return;

    setPublishing(true);
    setErr("");

    const { error } = await supabase.rpc("publish_expense_draft", { p_batch_id: selectedBatch.id });
    if (error) {
      setErr(error.message);
      setPublishing(false);
      return;
    }

    setPublishing(false);

    // After publish, draft disappears from this page anyway (we query only drafts).
    setSelectedBatchId(null);
    await loadAll();
    showToast("Published");
  };

  if (!orgId) {
    return <div className="p-6 text-slate-700">No active organization selected.</div>;
  }

  if (loading) {
    return <div className="p-10 text-slate-700">Loading…</div>;
  }

  return (
    <>
      <Toast show={toastOpen} text={toastText} />

      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Expense</div>
            <div className="text-sm text-slate-600">Draft batches and Publish to ledger</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                draftCount >= 10 ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
              }`}
              disabled={draftCount >= 10}
              onClick={openCreateBatch}
              title={draftCount >= 10 ? "Max 10 drafts reached" : "Create a new draft batch"}
            >
              New draft batch
            </button>

            <button
              className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              onClick={() => router.push("/app/expense/published")}
            >
              View Published
            </button>
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

      {/* Body */}
      <div className="p-6">
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: Draft batches */}
          <div className="rounded-3xl border p-5 lg:col-span-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Draft Batches</div>
                <div className="mt-1 text-xs text-slate-600">{draftCount} / 10 drafts</div>
              </div>
              {/* <Pill>v1</Pill> */}
            </div>

            <div className="mt-4 space-y-5">
              {batches.length === 0 ? (
                <div className="rounded-2xl border bg-primary/5 p-4 text-sm text-slate-700">
                  No draft batches yet. Create one to start.
                </div>
              ) : (
                batches.map((b) => {
                  const active = b.id === selectedBatchId;
                  const label = `Expense Entry — ${fmtMonth(b.period_month)}`;

                  return (
                    <div key={b.id} className="rounded-2xl border bg-white overflow-hidden">
                      <button
                       className={`w-full px-4 py-3 text-left text-sm ${
                          active ?"bg-primary text-white": "hover:bg-slate-50"
                        }`}
                        onClick={() => setSelectedBatchId(b.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{label}</div>
                            <div className={`font-medium truncate ${active ? "text-white" : ""}`}>
                              Draft • Updated {fmtDate(b.updated_at)}
                            </div>
                          </div>
                          <div className="shrink-0">
                            <Pill>Draft</Pill>
                          </div>
                        </div>
                      </button>

                      {isFinance ? (
                        <div className="border-t px-4 py-2">
                          <button
                            className="w-full rounded-xl border px-3 py-2 text-xs hover:bg-slate-50"
                            onClick={() => deleteDraftBatch(b.id)}
                          >
                            Delete draft
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Workspace */}
          <div className="rounded-3xl border p-5 lg:col-span-8">
            {!selectedBatch ? (
              <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                Select a draft batch to add and edit expense items.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">
                      Expense Entry — {fmtMonth(selectedBatch.period_month)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Status: draft • {batchSummary.count} items • {formatMoney(batchSummary.cents)} (draft total)
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={openAddItem}
                    >
                      Add line
                    </button>

                    <button
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                        !isFinance || publishing ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={!isFinance || publishing}
                      onClick={publishBatch}
                      title={!isFinance ? "Finance/Admin only" : "Publish this draft"}
                    >
                      {publishing ? "Publishing…" : "Publish"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                  Add and edit draft expenses, then publish. Published entries become immutable.
                </div>

                {/* Items table */}
                <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-[1100px]">
                      <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100 rounded-t-3xl">
                        <div className="col-span-2">Date</div>
                        <div className="col-span-3">Description</div>
                        <div className="col-span-1">Category</div>
                        <div className="col-span-1">Method</div>
                        <div className="col-span-1">Cheque #</div>
                        <div className="col-span-1 text-right">Amount</div>
                        <div className="col-span-3 text-right">Actions</div>
                      </div>

                      {items.length === 0 ? (
                        <div className="p-6 text-sm text-slate-600">No items in this draft yet.</div>
                      ) : (
                        <div className="divide-y">
                          {items.map((it) => (
                            <div key={it.id} className="grid grid-cols-12 items-center gap-2 px-5 py-4 text-sm">
                                <div className="col-span-2 text-slate-700">{fmtDate(it.expense_date)}</div>
                                <div className="col-span-3">
                                <div className="font-medium text-slate-900 line-clamp-1">{it.description}</div>
                                {it.vendor ? <div className="mt-0.5 text-xs text-slate-500">Vendor: {it.vendor}</div> : null}
                                </div>

                                <div className="col-span-1 font-semibold">
                                {expenseCatNameById.get(it.expense_category_id) ?? "—"}
                                </div>

                                <div className="col-span-1 text-slate-700">{it.payment_method}</div>

                                <div className="col-span-1 text-slate-700">
                                {it.payment_method === "cheque" ? it.cheque_number ?? "—" : "—"}
                                </div>

                                <div className="col-span-1 text-right font-semibold">{formatMoney(it.amount_cents)}</div>

                                <div className="col-span-3 flex justify-end gap-2">
                                <button
                                    className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                    onClick={() => openEditItem(it)}
                                >
                                    Edit
                                </button>
                                <button
                                    className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                    onClick={() => removeItem(it.id)}
                                >
                                    Remove
                                </button>
                                </div>

                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {!isFinance ? (
                  <div className="mt-4 text-xs text-slate-500">
                    Anyone can add/edit drafts. Only Finance/Admin can publish. Only Finance/Admin can delete drafts.
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create batch modal */}
      {batchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        onClick={() => setBatchOpen(false)}>
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">New expense draft batch</div>
              <div className="text-xs text-slate-600">Pick the month you’re entering expenses for.</div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Month *</div>
                <input
                  type="month"
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={batchMonth}
                  onChange={(e) => setBatchMonth(e.target.value)}
                />
                <div className="mt-2 text-xs text-slate-500">
                  This will create a batch like: <span className="font-semibold">Expense Entry — {batchMonth ? batchMonth : "YYYY-MM"}</span>
                </div>
              </div>

              {draftCount >= 10 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Max 10 drafts reached. Publish or delete one to create a new batch.
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setBatchOpen(false)}
              >
                Cancel
              </button>
              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  draftCount >= 10 ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={draftCount >= 10}
                onClick={createBatch}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add/Edit item modal */}
      {itemOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        onClick={() => setItemOpen(false)}>
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                {itemMode === "create" ? "Add expense line" : "Edit expense line"}
              </div>
              <div className="text-xs text-slate-600">Draft items can be edited freely until publishing.</div>
            </div>

            <div className="max-h-[75vh] overflow-auto px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Date *</div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={expenseDate}
                    onChange={(e) => {
                      setExpenseDate(e.target.value);
                      setItemErr("");
                    }}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Expense category *</div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={expenseCategoryId}
                    onChange={(e) => {
                      setExpenseCategoryId(e.target.value);
                      setItemErr("");
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
                <div className="mb-1 text-xs font-semibold text-slate-600">Description *</div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setItemErr("");
                  }}
                  placeholder="e.g., Fuel for generator, Printing, Rent, etc."
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Vendor (optional)</div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={vendor}
                  onChange={(e) => {
                    setVendor(e.target.value);
                    setItemErr("");
                  }}
                  placeholder="e.g., Shell, Walmart, Verizon"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Method *</div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={paymentMethod}
                    onChange={(e) => {
                      setPaymentMethod(e.target.value as PaymentMethod);
                      setItemErr("");
                      if (e.target.value !== "cheque") setChequeNumber("");
                    }}
                  >
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="online">Online</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Cheque number {paymentMethod === "cheque" ? "*" : ""}
                  </div>
                  <input
                    className={`w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 ${
                      paymentMethod !== "cheque" ? "bg-slate-50 text-slate-500" : ""
                    }`}
                    value={chequeNumber}
                    onChange={(e) => {
                      setChequeNumber(e.target.value);
                      setItemErr("");
                    }}
                    disabled={paymentMethod !== "cheque"}
                    placeholder={paymentMethod === "cheque" ? "e.g., 103849" : "—"}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Amount *</div>
                <input
                  ref={amountRef}
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setItemErr("");
                  }}
                  placeholder="e.g., 250.00"
                />
              </div>

              {itemErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {itemErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setItemOpen(false)}
              >
                Close
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  savingItem ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={savingItem}
                onClick={saveItem}
              >
                {savingItem ? "Saving…" : itemMode === "create" ? "Save & add another" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
