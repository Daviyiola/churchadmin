"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { useRouter } from "next/navigation";

type Role = "owner" | "admin" | "finance" | "member";
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

type ImportJob = {
  id: string;
  org_id: string;
  target_batch_id: string;
  status: "reviewing" | "appended" | "cancelled";
  created_at: string;
};

type ImportRowStatus = "needs_review" | "ready" | "blocked";

type ExpenseImportRow = {
  id: string;
  job_id: string;
  org_id: string;

  status: ImportRowStatus;
  row_index: number;

  // expense fields
  expense_date: string | null; // YYYY-MM-DD or null -> default to batch month
  expense_category_id: string | null;
  description: string;
  vendor: string | null;
  payment_method: PaymentMethod;
  cheque_number: string | null;
  amount_cents: number | null;

  // review fields
  errors: string[];

  _dirty: boolean;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.error === "string") return rec.error;
  }
  return "Unknown error";
}

function asExpenseImportRowArray(input: unknown): ExpenseImportRow[] {
  if (!Array.isArray(input)) return [];
  // minimal runtime shaping (no 'any')
  return input
    .map((v): ExpenseImportRow | null => {
      if (!v || typeof v !== "object") return null;
      const r = v as Record<string, unknown>;

      // required-ish fields
      const id = typeof r.id === "string" ? r.id : null;
      const job_id = typeof r.job_id === "string" ? r.job_id : null;
      const org_id = typeof r.org_id === "string" ? r.org_id : null;

      const status =
        r.status === "needs_review" ||
        r.status === "ready" ||
        r.status === "blocked"
          ? (r.status as ImportRowStatus)
          : "needs_review";

      const row_index = typeof r.row_index === "number" ? r.row_index : 0;

      if (!id || !job_id || !org_id) return null;

      return {
        id,
        job_id,
        org_id,
        status,
        row_index,

        expense_date:
          typeof r.expense_date === "string" ? r.expense_date : null,
        expense_category_id:
          typeof r.expense_category_id === "string"
            ? r.expense_category_id
            : null,
        description: typeof r.description === "string" ? r.description : "",
        vendor: typeof r.vendor === "string" ? r.vendor : null,
        payment_method:
          r.payment_method === "cash" ||
          r.payment_method === "cheque" ||
          r.payment_method === "online"
            ? (r.payment_method as PaymentMethod)
            : "online",
        cheque_number:
          typeof r.cheque_number === "string" ? r.cheque_number : null,
        amount_cents:
          typeof r.amount_cents === "number" ? r.amount_cents : null,

        errors: Array.isArray(r.errors)
          ? r.errors
          : typeof r.error === "string"
            ? [r.error]
            : [],

        _dirty: false,
      };
    })
    .filter((x): x is ExpenseImportRow => x !== null);
}

function parseDateMaybe(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  // accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // accept MM/DD/YYYY
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = String(Number(m[1])).padStart(2, "0");
    const dd = String(Number(m[2])).padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseCsvSimple(text: string): string[][] {
  // v1: simple CSV parser (handles quotes)
  const rows: string[][] = [];
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (c === '"') {
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        field += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
      if (c === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }

      // newline
      row.push(field);
      field = "";

      // swallow \r\n
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i++;

      // ignore empty trailing row
      if (row.some((x) => String(x ?? "").trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += c;
    i++;
  }

  row.push(field);
  if (row.some((x) => String(x ?? "").trim() !== "")) rows.push(row);

  return rows;
}

function normHeader(h: string) {
  return (h ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function asPaymentMethod(raw: string): PaymentMethod {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "cheque" || v === "check" || v === "cheq") return "cheque";
  if (v === "online" || v === "card" || v === "transfer") return "online";
  return "online"; // default
}

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
        show
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="rounded-2xl border bg-white px-4 py-3 text-sm shadow-lg">
        {text}
      </div>
    </div>
  );
}

export default function ExpenseDraftPage() {
  const orgId = getActiveOrgId();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const isFinance = role === "finance" || role === "admin" || role === "owner";

  // quick add expense category
  const [quickExpenseCatOpen, setQuickExpenseCatOpen] = useState(false);
  const [qecName, setQecName] = useState("");
  const [qecSaving, setQecSaving] = useState(false);
  const [qecErr, setQecErr] = useState("");

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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("online");
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
    [batches, selectedBatchId],
  );

  const [expenseCatQuery, setExpenseCatQuery] = useState("");
  const [expenseCatSuggestOpen, setExpenseCatSuggestOpen] = useState(false);
  const clearedExpenseCatOnFocusRef = useRef(false);

  const expenseCatLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of expenseCats) map.set(c.id, c.name);
    return map;
  }, [expenseCats]);

  const expenseCatIdByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of expenseCats) map.set(c.name.toLowerCase(), c.id);
    return map;
  }, [expenseCats]);

  const filteredExpenseCats = useMemo(() => {
    const needle = expenseCatQuery.trim().toLowerCase();
    if (!needle) return expenseCats.slice(0, 8);
    return expenseCats
      .filter((c) => c.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [expenseCatQuery, expenseCats]);

  const exactExpenseCatMatchId = useMemo(() => {
    const id = expenseCatIdByLabel.get(expenseCatQuery.trim().toLowerCase());
    return id ?? null;
  }, [expenseCatQuery, expenseCatIdByLabel]);

  const showAddExpenseCatRow = useMemo(() => {
    const q = expenseCatQuery.trim();
    if (q.length < 2) return false;
    return !exactExpenseCatMatchId;
  }, [expenseCatQuery, exactExpenseCatMatchId]);

  // ===== CSV Import (Expense) =====
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "review">("upload");
  const [importErr, setImportErr] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [importRows, setImportRows] = useState<ExpenseImportRow[]>([]);
  const [importDirty, setImportDirty] = useState(false);
  const [importSavedAt, setImportSavedAt] = useState<string>("");

  const [importFilter, setImportFilter] = useState<
    "all" | "needs_review" | "ready" | "blocked"
  >("all");

  const expenseCatIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of expenseCats) map.set(c.name.trim().toLowerCase(), c.id);
    return map;
  }, [expenseCats]);

  const isUpload = importStep === "upload";

  const [savingImport, setSavingImport] = useState(false);
  const [appendingImport, setAppendingImport] = useState(false);

  const readyCount = useMemo(
    () => importRows.filter((r) => r.status === "ready").length,
    [importRows],
  );

  const canAppend =
    !importDirty && !savingImport && !appendingImport && readyCount > 0;

  function openQuickAddExpenseCategoryFromQuery(q: string) {
    setQecName(q.trim());
    setQecErr("");
    setQuickExpenseCatOpen(true);
  }

  const botXRef = useRef<HTMLDivElement | null>(null);

  async function saveQuickExpenseCategory() {
    if (!orgId) return;

    const name = qecName.trim();
    if (!name) {
      setQecErr("Category name is required.");
      return;
    }

    setQecSaving(true);
    setQecErr("");

    const { data: sessionRes } = await supabase.auth.getSession();
    const userId = sessionRes.session?.user?.id;
    if (!userId) {
      setQecErr("You must be signed in.");
      setQecSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("categories")
      .insert({
        org_id: orgId,
        name,
        type: "expense",
        status: "active",
        created_by: userId,
      })
      .select("id,name")
      .single();

    if (error) {
      setQecErr(error.message);
      setQecSaving(false);
      return;
    }

    await loadAll();

    if (data?.id) {
      setExpenseCategoryId(data.id);
      setExpenseCatQuery(data.name);
    }

    setQecSaving(false);
    setQuickExpenseCatOpen(false);
    showToast("Expense category added");
  }
  const abandonImportJob = useCallback(async (): Promise<boolean> => {
    // If there is something worth warning about, confirm.
    if (importJob && importRows.length > 0) {
      const ok = window.confirm(
        "Discard this import? All uploaded rows will be lost.",
      );
      if (!ok) return false; // user cancelled
    }

    if (!importJob) {
      setImportRows([]);
      setImportStep("upload");
      setImportDirty(false);
      setImportSavedAt("");
      setImportFilter("all");
      return true;
    }

    const { error } = await supabase
      .from("import_jobs")
      .delete()
      .eq("id", importJob.id)
      .eq("org_id", importJob.org_id);

    if (error) {
      console.error(error);
      return false;
    }

    setImportJob(null);
    setImportRows([]);
    setImportStep("upload");
    setImportDirty(false);
    setImportSavedAt("");
    setImportFilter("all");
    return true;
  }, [importJob, importRows.length, supabase]);

  async function createExpenseImportJob(
    batchId: string,
    filename?: string,
  ): Promise<ImportJob> {
    if (!orgId) throw new Error("No org");

    const { data, error } = await supabase
      .from("import_jobs")
      .insert({
        org_id: orgId,
        target_type: "expense_draft_batch",
        target_batch_id: batchId,
        filename: filename ?? null,
        file_type: "csv",
        kind: "expense",
        status: "reviewing",
        // kind exists, but has default 'expense' so you can omit it
      })
      .select("id,org_id,target_batch_id,status,created_at")
      .single();

    if (error) throw new Error(error.message);
    return data as ImportJob;
  }

  function validateExpenseRowLocal(r: ExpenseImportRow): ExpenseImportRow {
    if (r.status === "blocked") return r; // keep blocked until user edits amount

    const errors: string[] = [];
    if (!r.description?.trim()) errors.push("Description required");
    if (!r.expense_category_id) errors.push("Category required");
    if (!r.amount_cents || r.amount_cents <= 0)
      errors.push("Amount must be > 0");
    if (r.payment_method === "cheque" && !(r.cheque_number ?? "").trim()) {
      errors.push("Cheque # required");
    }

    return { ...r, status: errors.length ? "needs_review" : "ready", errors };
  }

  async function bulkInsertImportRows(
    job: ImportJob,
    rows: ExpenseImportRow[],
  ) {
    // keep payload minimal
    const payload = rows.map((r) => ({
      job_id: job.id,
      org_id: job.org_id,
      status: r.status,
      row_index: r.row_index,
      expense_date: r.expense_date,
      expense_category_id: r.expense_category_id,
      description: r.description,
      vendor: r.vendor,
      payment_method: r.payment_method,
      cheque_number: r.cheque_number,
      amount_cents: r.amount_cents,
      errors: r.errors,
    }));

    const { error } = await supabase.from("import_rows").insert(payload);
    if (error) throw new Error(error.message);
  }

  async function onPickCsvFile(file: File) {
    if (!selectedBatch) return;
    if (selectedBatch.status !== "draft") return;

    setImportErr("");
    setImportBusy(true);

    try {
      const text = await file.text();
      const matrix = parseCsvSimple(text);
      if (matrix.length < 2) throw new Error("CSV looks empty");

      const headers = matrix[0].map(normHeader);

      // expected headers (flexible):
      // date, category, description, vendor, amount, method, cheque_number
      const idx = (name: string) => headers.indexOf(name);

      const iDate = idx("date");
      const iCat = idx("category");
      const iDesc = idx("description");
      const iVendor = idx("vendor");
      const iAmount = idx("amount");
      const iMethod = idx("method");
      const iCheque = idx("cheque_number");

      if (iCat < 0 || iDesc < 0 || iAmount < 0) {
        throw new Error(
          "CSV must include headers: category, description, amount",
        );
      }

      // Create job
      const job = await createExpenseImportJob(selectedBatch.id, file.name);
      setImportJob(job);

      // Parse rows into staging objects
      const parsed: ExpenseImportRow[] = [];

      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        const rawDate = iDate >= 0 ? (row[iDate] ?? "") : "";
        const rawCat = row[iCat] ?? "";
        const rawDesc = row[iDesc] ?? "";
        const rawVendor = iVendor >= 0 ? (row[iVendor] ?? "") : "";
        const rawAmount = row[iAmount] ?? "";
        const rawMethod = iMethod >= 0 ? (row[iMethod] ?? "") : "";
        const rawCheque = iCheque >= 0 ? (row[iCheque] ?? "") : "";

        const catId =
          expenseCatIdByName.get(String(rawCat).trim().toLowerCase()) ?? null;

        const centsRaw = parseMoneyToCents(String(rawAmount));
        const centsAbs = centsRaw === null ? null : Math.abs(centsRaw);
        const amount_cents =
          centsAbs === null ? null : centsAbs === 0 ? null : centsAbs;

        const payment_method = asPaymentMethod(String(rawMethod));
        const cheque_number =
          payment_method === "cheque" ? String(rawCheque).trim() || null : null;

        const dateParsed = parseDateMaybe(String(rawDate));
        const userProvidedDate = String(rawDate ?? "").trim().length > 0;

        let rowObj: ExpenseImportRow = {
          id: crypto.randomUUID(),
          job_id: job.id,
          org_id: job.org_id,
          status: "needs_review",
          row_index: r,
          expense_date: dateParsed ?? null,
          expense_category_id: catId,
          description: String(rawDesc ?? "").trim(),
          vendor: String(rawVendor ?? "").trim() || null,
          payment_method,
          cheque_number,
          amount_cents,
          errors: [],
          _dirty: false,
        };

        rowObj = validateExpenseRowLocal(rowObj);

        if (userProvidedDate && !dateParsed) {
          rowObj = {
            ...rowObj,
            status: "needs_review",
            errors: [...rowObj.errors, "Invalid date"],
          };
        }

        parsed.push(rowObj);
      }

      // Insert into DB staging (we’ll re-fetch after insert)
      await bulkInsertImportRows(job, parsed);

      // Fetch staging rows from DB (real ids)
      const { data, error } = await supabase
        .from("import_rows")
        .select(
          "id,job_id,org_id,status,row_index,expense_date,expense_category_id,description,vendor,payment_method,cheque_number,amount_cents,errors",
        )

        .eq("job_id", job.id)
        .eq("org_id", job.org_id)
        .order("row_index", { ascending: true });

      if (error) throw new Error(error.message);

      setImportRows(asExpenseImportRowArray(data));
      setImportStep("review");
      setImportDirty(false);
      setImportSavedAt("");
    } catch (e: unknown) {
      setImportErr(errorMessage(e) || "Import failed");
    } finally {
      setImportBusy(false);
    }
  }
  function patchImportRowLocal(id: string, patch: Partial<ExpenseImportRow>) {
    setImportRows((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;

        const merged: ExpenseImportRow = { ...r, ...patch, _dirty: true };

        merged.description = (merged.description ?? "").trim();
        merged.vendor = merged.vendor ? merged.vendor.trim() || null : null;

        if (merged.payment_method !== "cheque") merged.cheque_number = null;
        if (merged.payment_method === "cheque") {
          merged.cheque_number = (merged.cheque_number ?? "").trim() || null;
        }

        return validateExpenseRowLocal(merged);
      });

      return next;
    });

    setImportDirty(true);
    setImportSavedAt("");
  }

  async function saveImportChanges() {
    if (!importJob || importRows.length === 0) return;

    setSavingImport(true);
    setImportErr("");

    try {
      const dirty = importRows.filter((r) => r._dirty);

      if (dirty.length === 0) {
        setImportDirty(false);
        setImportSavedAt(new Date().toLocaleTimeString());
        showToast("No changes to save");
        return;
      }

      // Update rows one-by-one (simple + safe for v1)
      // If you expect hundreds/thousands, we can switch to an RPC later.
      for (const r of dirty) {
        const { error } = await supabase
          .from("import_rows")
          .update({
            status: r.status,
            expense_date: r.expense_date,
            expense_category_id: r.expense_category_id,
            description: r.description.trim(),
            vendor: r.vendor?.trim() || null,
            payment_method: r.payment_method,
            cheque_number:
              r.payment_method === "cheque"
                ? r.cheque_number?.trim() || null
                : null,
            amount_cents: r.amount_cents,
            errors: r.errors,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id)
          // extra safety: prevent updating a row you don't "own"
          .eq("org_id", importJob.org_id)
          .eq("job_id", importJob.id);

        if (error) throw new Error(error.message);
      }

      // Clear dirty flags locally
      setImportRows((prev) =>
        prev.map((r) => (r._dirty ? { ...r, _dirty: false } : r)),
      );

      setImportDirty(false);
      setImportSavedAt(new Date().toLocaleTimeString());
      showToast("Import changes saved");
    } catch (e: unknown) {
      setImportErr(errorMessage(e) || "Save failed");
    } finally {
      setSavingImport(false);
    }
  }

  async function appendReadyRows() {
    if (!importJob) return;

    if (importDirty) {
      setImportErr("Save changes before appending.");
      return;
    }

    if (readyCount === 0) {
      setImportErr("No ready rows to append.");
      return;
    }

    setImportErr("");
    setAppendingImport(true);

    try {
      const { data, error } = await supabase.rpc("append_expense_import_job", {
        p_job_id: importJob.id,
      });
      if (error) throw new Error(error.message);

      const inserted =
        typeof (data as { inserted?: unknown } | null)?.inserted === "number"
          ? (data as { inserted: number }).inserted
          : 0;

      if (selectedBatchId) await loadItems(selectedBatchId);

      showToast(`Appended ${inserted} rows`);

      setImportOpen(false);
      setImportJob(null);
      setImportRows([]);
      setImportStep("upload");
      setImportDirty(false);
      setImportSavedAt("");
      setImportFilter("all");
    } catch (e: unknown) {
      setImportErr(errorMessage(e) || "Append failed");
    } finally {
      setAppendingImport(false);
    }
  }

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
        .select(
          "id,org_id,period_month,status,created_by,created_at,updated_at,posted_by,posted_at",
        )
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
        "id,org_id,batch_id,expense_date,expense_category_id,description,vendor,payment_method,cheque_number,amount_cents,created_by,created_at,updated_at",
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
    if (importOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [importOpen]);

  useEffect(() => {
    if (selectedBatchId) loadItems(selectedBatchId);
    else setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  const closeImportModal = useCallback(async () => {
    const abandoned = await abandonImportJob();
    if (!abandoned) return; // user cancelled or delete failed
    setImportOpen(false);
  }, [abandonImportJob]);

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

    const ok = confirm(
      "Delete this draft batch? This will remove all its draft items.",
    );
    if (!ok) return;

    const { error } = await supabase
      .from("expense_draft_batches")
      .delete()
      .eq("id", batchId);
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

    const firstCat = expenseCats[0]?.id ?? "";
    setExpenseCategoryId(firstCat);
    setExpenseCatQuery(
      firstCat ? (expenseCatLabelById.get(firstCat) ?? "") : "",
    );

    setPaymentMethod("online");
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
    setExpenseCatQuery(expenseCatLabelById.get(it.expense_category_id) ?? "");
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

    const { error } = await supabase
      .from("expense_draft_items")
      .delete()
      .eq("id", id);
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

    const { error } = await supabase.rpc("publish_expense_draft", {
      p_batch_id: selectedBatch.id,
    });
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
    return (
      <div className="p-6 text-slate-700">No active organization selected.</div>
    );
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
            <div className="text-sm text-slate-600">
              Draft batches and Publish to ledger
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                draftCount >= 10
                  ? "bg-slate-300"
                  : "bg-primary hover:bg-primary/85"
              }`}
              disabled={draftCount >= 10}
              onClick={openCreateBatch}
              title={
                draftCount >= 10
                  ? "Max 10 drafts reached"
                  : "Create a new draft batch"
              }
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
                <div className="mt-1 text-xs text-slate-600">
                  {draftCount} / 10 drafts
                </div>
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
                    <div
                      key={b.id}
                      className="rounded-2xl border bg-white overflow-hidden"
                    >
                      <button
                        className={`w-full px-4 py-3 text-left text-sm ${
                          active ? "bg-primary text-white" : "hover:bg-slate-50"
                        }`}
                        onClick={() => setSelectedBatchId(b.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{label}</div>
                            <div
                              className={`font-medium truncate ${
                                active ? "text-white" : ""
                              }`}
                            >
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
                      Status: draft • {batchSummary.count} items •{" "}
                      {formatMoney(batchSummary.cents)} (draft total)
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
                      className={`rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 ${
                        !selectedBatch || selectedBatch.status !== "draft"
                          ? "opacity-50 pointer-events-none"
                          : ""
                      }`}
                      onClick={() => {
                        setImportErr("");
                        setImportJob(null);
                        setImportRows([]);
                        setImportStep("upload");
                        setImportDirty(false);
                        setImportSavedAt("");
                        setImportFilter("all");
                        setImportOpen(true);
                      }}
                      title={
                        !selectedBatch
                          ? "Select a draft batch first"
                          : "Import CSV into this draft"
                      }
                    >
                      Import CSV
                    </button>

                    <button
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                        !isFinance || publishing
                          ? "bg-slate-300"
                          : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={!isFinance || publishing}
                      onClick={publishBatch}
                      title={
                        !isFinance ? "Finance/Admin only" : "Publish this draft"
                      }
                    >
                      {publishing ? "Publishing…" : "Publish"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                  Add and edit draft expenses, then publish. Published entries
                  become immutable.
                </div>

                {/* Items table */}
                <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-[1100px]">
                      <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100 rounded-t-3xl">
                        <div className="col-span-2">Date</div>
                        <div className="col-span-3">Description</div>
                        <div className="col-span-2">Category</div>
                        <div className="col-span-1 ">Amount</div>
                        <div className="col-span-1">Method</div>
                        {/* <div className="col-span-1">Cheque #</div> */}
                        <div className="col-span-3 text-right">Actions</div>
                      </div>

                      {items.length === 0 ? (
                        <div className="p-6 text-sm text-slate-600">
                          No items in this draft yet.
                        </div>
                      ) : (
                        <div className="divide-y">
                          {items.map((it) => (
                            <div
                              key={it.id}
                              className="grid grid-cols-12 items-center gap-2 px-5 py-4 text-sm"
                            >
                              <div className="col-span-2 text-slate-700">
                                {fmtDate(it.expense_date)}
                              </div>
                              <div className="col-span-3">
                                <div className="font-medium text-slate-900 line-clamp-1">
                                  {it.description}
                                </div>
                                {it.vendor ? (
                                  <div className="mt-0.5 text-xs text-slate-500">
                                    Vendor: {it.vendor}
                                  </div>
                                ) : null}
                              </div>

                              <div className="col-span-2 font-semibold">
                                {expenseCatNameById.get(
                                  it.expense_category_id,
                                ) ?? "—"}
                              </div>

                              <div className="col-span-1 font-semibold">
                                {formatMoney(it.amount_cents)}
                              </div>

                              <div className="col-span-1 text-slate-700">
                                {it.payment_method}
                              </div>

                              {/* <div className="col-span-1 text-slate-700">
                                {it.payment_method === "cheque"
                                  ? it.cheque_number ?? "—"
                                  : "—"}
                              </div> */}

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
                    Anyone can add/edit drafts. Only Finance/Admin can publish.
                    Only Finance/Admin can delete drafts.
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create batch modal */}
      {batchOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setBatchOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">
                  New expense draft batch
                </div>
                <div className="text-xs text-slate-600">
                  Pick the month you’re entering expenses for.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setBatchOpen(false)}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Month *
                </div>
                <input
                  type="month"
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={batchMonth}
                  onChange={(e) => setBatchMonth(e.target.value)}
                />
                <div className="mt-2 text-xs text-slate-500">
                  This will create a batch like:{" "}
                  <span className="font-semibold">
                    Expense Entry — {batchMonth ? batchMonth : "YYYY-MM"}
                  </span>
                </div>
              </div>

              {draftCount >= 10 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Max 10 drafts reached. Publish or delete one to create a new
                  batch.
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
                  draftCount >= 10
                    ? "bg-slate-300"
                    : "bg-primary hover:bg-primary/85"
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

      {quickExpenseCatOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setQuickExpenseCatOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Add expense category</div>
              <div className="text-xs text-slate-600">
                Quick add without leaving Expense.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Name *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={qecName}
                  onChange={(e) => {
                    setQecName(e.target.value);
                    setQecErr("");
                  }}
                  placeholder="e.g., Fuel, Rent, Utilities…"
                  autoFocus
                />
              </div>

              {qecErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {qecErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setQuickExpenseCatOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  qecSaving ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={qecSaving}
                onClick={saveQuickExpenseCategory}
              >
                {qecSaving ? "Saving…" : "Save category"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add/Edit item modal */}
      {itemOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-6xl h-[90vh] rounded-3xl bg-white shadow-xl flex flex-col overflow-hidden">
            <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">
                  {itemMode === "create"
                    ? "Add expense line"
                    : "Edit expense line"}
                </div>
                <div className="text-xs text-slate-600">
                  Draft items can be edited freely until publishing.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setItemOpen(false)}
                className="rounded-full p-1.5 text-slate-900 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[75vh] overflow-auto px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Date *
                  </div>
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
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Expense category *
                  </div>
                  <div className="relative">
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      value={expenseCatQuery}
                      onFocus={() => {
                        setExpenseCatSuggestOpen(true);

                        // clear when cursor hits field (same behavior you liked)
                        if (!clearedExpenseCatOnFocusRef.current) {
                          clearedExpenseCatOnFocusRef.current = true;
                          setExpenseCatQuery("");
                          setExpenseCategoryId("");
                          setItemErr("");
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(
                          () => setExpenseCatSuggestOpen(false),
                          120,
                        );
                        clearedExpenseCatOnFocusRef.current = false;
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExpenseCatQuery(v);
                        setItemErr("");

                        const id = expenseCatIdByLabel.get(
                          v.trim().toLowerCase(),
                        );
                        setExpenseCategoryId(id ?? "");
                        setExpenseCatSuggestOpen(true);
                      }}
                      placeholder="Type a category…"
                    />

                    {expenseCatSuggestOpen ? (
                      <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-y-auto overscroll-contain">
                        {filteredExpenseCats.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-600">
                            No matches.
                          </div>
                        ) : (
                          filteredExpenseCats.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setExpenseCategoryId(c.id);
                                setExpenseCatQuery(c.name);
                                setExpenseCatSuggestOpen(false);
                                setItemErr("");
                              }}
                            >
                              {c.name}
                            </button>
                          ))
                        )}

                        {showAddExpenseCatRow ? (
                          <div className="border-t">
                            <button
                              type="button"
                              className="block w-full px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() =>
                                openQuickAddExpenseCategoryFromQuery(
                                  expenseCatQuery,
                                )
                              }
                            >
                              + Add expense category
                              {expenseCatQuery.trim()
                                ? `: “${expenseCatQuery.trim()}”`
                                : ""}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!expenseCategoryId && expenseCatQuery.trim().length > 0 ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Select a valid category (or add a new one).
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Description *
                </div>
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
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Vendor (optional)
                </div>
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
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Method *
                  </div>
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
                      paymentMethod !== "cheque"
                        ? "bg-slate-50 text-slate-500"
                        : ""
                    }`}
                    value={chequeNumber}
                    onChange={(e) => {
                      setChequeNumber(e.target.value);
                      setItemErr("");
                    }}
                    disabled={paymentMethod !== "cheque"}
                    placeholder={
                      paymentMethod === "cheque" ? "e.g., 103849" : "—"
                    }
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Amount *
                </div>
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
                className="rounded-2xl border px-35 py-2 text-sm hover:bg-slate-50"
                onClick={() => setItemOpen(false)}
              >
                Close
              </button>

              <button
                className={`rounded-2xl px-35 py-2 text-sm font-semibold text-white ${
                  savingItem ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={savingItem}
                onClick={saveItem}
              >
                {savingItem
                  ? "Saving…"
                  : itemMode === "create"
                    ? "Save"
                    : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===================== Import CSV modal (FULL, scroll-proof) ===================== */}
      {importOpen ? (
        <div
          className="fixed inset-0 z-[70] bg-black/30"
          onClick={() => {
            // backdrop click closes
            void (async () => {
              void closeImportModal();
            })();
          }}
        >
          <div className="h-[100dvh] w-full p-4 flex items-center justify-center">
            <div
              className={[
                "w-full max-w-6xl rounded-3xl bg-white shadow-xl",
                "flex flex-col overflow-hidden",
                // Upload step: don't force full height (removes useless white space)
                isUpload
                  ? "h-auto max-h-[calc(100dvh-4rem)]"
                  : "h-[calc(100dvh-4rem)]",
              ].join(" ")}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ================= Header (fixed) ================= */}
              <div className="shrink-0 border-b px-6 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    Import Expenses (CSV)
                  </div>
                  <div className="text-xs text-slate-600">
                    Upload a CSV → review rows → save changes → append ready
                    rows into the current draft.
                  </div>
                </div>

                <button
                  type="button"
                  disabled={importBusy}
                  onClick={async () => {
                    void closeImportModal();
                  }}
                  className={`rounded-full p-1.5 ${
                    importBusy
                      ? "text-slate-300"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                  aria-label="Close"
                  title={importBusy ? "Please wait…" : "Close"}
                >
                  ✕
                </button>
              </div>

              {/* ================= Body (VERTICAL SCROLLER) ================= */}
              <div
                className={[
                  "px-6 py-6",
                  isUpload
                    ? "flex-none overflow-visible"
                    : "flex-1 min-h-0 overflow-y-auto",
                ].join(" ")}
              >
                {importErr ? (
                  <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {importErr}
                  </div>
                ) : null}

                {importStep === "upload" ? (
                  <div className="grid gap-6 lg:grid-cols-12">
                    {/* Left: Upload */}
                    {/* Left: Upload */}
                    <div className="lg:col-span-5 rounded-3xl border bg-slate-50 p-5 flex flex-col">
                      <div className="text-sm font-semibold">
                        Step 1 — Upload CSV
                      </div>

                      <div className="mt-1 text-xs text-slate-600">
                        Required headers:{" "}
                        <span className="font-semibold">
                          category, description, amount
                        </span>
                        . Optional: date, vendor, method, cheque_number.
                      </div>

                      <div className="mt-4 text-xs text-slate-500">
                        Notes:
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                          <li>
                            <span className="font-semibold">method</span>{" "}
                            defaults to{" "}
                            <span className="font-semibold">online</span> if
                            missing/unknown.
                          </li>
                          <li>Negative amounts are made positive</li>
                          <li>
                            Category must match an existing expense category
                            name.
                          </li>
                        </ul>
                      </div>

                      {/* Push chooser to the bottom */}
                      <div className="mt-auto pt-5">
                        <div className="text-xs font-semibold text-slate-600 mb-2">
                          CSV file
                        </div>

                        {/* Hidden native input */}
                        <input
                          id="expense-import-csv"
                          type="file"
                          accept=".csv,text/csv"
                          disabled={
                            importBusy ||
                            !selectedBatch ||
                            selectedBatch.status !== "draft"
                          }
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            if (!f) return;
                            void onPickCsvFile(f);
                            e.currentTarget.value = "";
                          }}
                          className="hidden"
                        />

                        {/* Button-like trigger */}
                        <label
                          htmlFor="expense-import-csv"
                          className={[
                            "group inline-flex w-full cursor-pointer items-center justify-center gap-2",
                            "rounded-2xl border bg-white px-4 py-3 text-sm font-semibold",
                            "transition active:scale-[0.99]",
                            "hover:bg-slate-50 hover:border-slate-300",
                            "focus-within:ring-2 focus-within:ring-primary/30",
                            importBusy ||
                            !selectedBatch ||
                            selectedBatch.status !== "draft"
                              ? "pointer-events-none opacity-50"
                              : "",
                          ].join(" ")}
                          title={
                            importBusy
                              ? "Please wait…"
                              : !selectedBatch ||
                                  selectedBatch.status !== "draft"
                                ? "Select a draft batch to import into"
                                : "Choose a CSV file"
                          }
                        >
                          <span>Choose CSV file</span>
                        </label>
                      </div>
                    </div>

                    {/* Right: Template + instructions */}
                    <div className="lg:col-span-7 rounded-3xl border p-5">
                      <div className="text-sm font-semibold">
                        CSV Template Example
                      </div>

                      {/* Horizontal scroller for the template table */}
                      <div className="mt-2 rounded-2xl border bg-white p-4 overflow-x-auto">
                        <div className="min-w-[900px] rounded-2xl border bg-white overflow-hidden">
                          <table className="w-full text-xs border-collapse">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="border px-3 py-2 text-left">
                                  date
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  category
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  description
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  vendor
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  amount
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  method
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  cheque_number
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="border px-3 py-2">2026-01-05</td>
                                <td className="border px-3 py-2">Fuel</td>
                                <td className="border px-3 py-2">
                                  Generator fuel
                                </td>
                                <td className="border px-3 py-2">Shell</td>
                                <td className="border px-3 py-2">120.50</td>
                                <td className="border px-3 py-2">cash</td>
                                <td className="border px-3 py-2"></td>
                              </tr>
                              <tr>
                                <td className="border px-3 py-2">01/07/2026</td>
                                <td className="border px-3 py-2">Utilities</td>
                                <td className="border px-3 py-2">
                                  Internet bill
                                </td>
                                <td className="border px-3 py-2">Verizon</td>
                                <td className="border px-3 py-2">85.00</td>
                                <td className="border px-3 py-2">online</td>
                                <td className="border px-3 py-2"></td>
                              </tr>
                              <tr>
                                <td className="border px-3 py-2"></td>
                                <td className="border px-3 py-2">
                                  Office Supplies
                                </td>
                                <td className="border px-3 py-2">
                                  Printer paper
                                </td>
                                <td className="border px-3 py-2">Walmart</td>
                                <td className="border px-3 py-2">34.99</td>
                                <td className="border px-3 py-2">cash</td>
                                <td className="border px-3 py-2"></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        <div className="mt-4 rounded-2xl border bg-blue-50 px-4 py-3 text-sm text-blue-900">
                          <div className="font-semibold mb-1">
                            How to prepare this in Excel
                          </div>
                          <ol className="list-decimal pl-5 space-y-1 text-xs">
                            <li>Open Microsoft Excel</li>
                            <li>Create columns exactly as shown above</li>
                            <li>Fill in your expense rows</li>
                            <li>
                              Click{" "}
                              <strong>
                                File → Save As → CSV (Comma delimited)
                              </strong>
                            </li>
                            <li>Upload the saved file here</li>
                          </ol>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        After upload, you’ll review and fix rows before
                        appending.
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* ================= Review toolbar ================= */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          Step 2 — Review
                        </span>

                        {importSavedAt ? (
                          <span className="text-xs text-slate-500">
                            Saved at{" "}
                            <span className="font-semibold">
                              {importSavedAt}
                            </span>
                          </span>
                        ) : null}

                        {importDirty ? (
                          <span className="text-xs rounded-full border bg-amber-50 px-2 py-1 text-amber-800">
                            Unsaved changes
                          </span>
                        ) : (
                          <span className="text-xs rounded-full border bg-slate-50 px-2 py-1 text-slate-600">
                            No pending changes
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="rounded-2xl border px-3 py-2 text-sm"
                          value={importFilter}
                          onChange={(e) =>
                            setImportFilter(
                              e.target.value as
                                | "all"
                                | "needs_review"
                                | "ready"
                                | "blocked",
                            )
                          }
                        >
                          <option value="all">All</option>
                          <option value="needs_review">Needs review</option>
                          <option value="ready">Ready</option>
                          <option value="blocked">Blocked</option>
                        </select>

                        <button
                          className={`rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 ${
                            importBusy ? "opacity-50 pointer-events-none" : ""
                          }`}
                          onClick={async () => {
                            if (importBusy) return;
                            await abandonImportJob();
                          }}
                        >
                          Start over
                        </button>

                        <button
                          className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                            savingImport
                              ? "bg-slate-300"
                              : "bg-primary hover:bg-primary/85"
                          }`}
                          disabled={savingImport || appendingImport}
                          onClick={saveImportChanges}
                          title={importDirty ? "Save edits" : "Save anyway"}
                        >
                          {savingImport ? "Saving…" : "Save changes"}
                        </button>

                        <button
                          className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                            canAppend
                              ? "bg-primary text-white hover:bg-primary/85"
                              : "bg-primary/10 text-slate-900 cursor-not-allowed"
                          }`}
                          disabled={!canAppend}
                          onClick={appendReadyRows}
                          title={
                            importDirty
                              ? "Save changes before appending"
                              : readyCount === 0
                                ? "No ready rows to append"
                                : "Append ready rows into draft"
                          }
                        >
                          {appendingImport
                            ? `Appending ${readyCount}…`
                            : `Append ready rows (${readyCount})`}
                        </button>
                      </div>
                    </div>

                    {/* ================= Summary cards ================= */}
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-600">Total rows</div>
                        <div className="text-lg font-semibold">
                          {importRows.length}
                        </div>
                      </div>

                      <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-600">Ready</div>
                        <div className="text-lg font-semibold">
                          {
                            importRows.filter((r) => r.status === "ready")
                              .length
                          }
                        </div>
                      </div>

                      <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-600">
                          Needs review
                        </div>
                        <div className="text-lg font-semibold">
                          {
                            importRows.filter(
                              (r) => r.status === "needs_review",
                            ).length
                          }
                        </div>
                      </div>
                    </div>

                    {/* ================= Review table ================= */}
                    {/* ================= Review table ================= */}
                    <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                      {/* Horizontal scroll lives here (single scrollbar) */}
                      <div
                        ref={botXRef}
                        className="overflow-x-auto overflow-y-visible"
                      >
                        <div className="min-w-[1200px]">
                          {/* Sticky header (sticks while modal BODY scrolls) */}
                          <div className="sticky top-0 z-20 grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100">
                            <div className="col-span-1">Row</div>
                            <div className="col-span-2">Date</div>
                            <div className="col-span-2">Category</div>
                            <div className="col-span-3">Description</div>
                            <div className="col-span-1">Amount</div>
                            <div className="col-span-1">Method</div>
                            <div className="col-span-2">Error</div>
                          </div>

                          {(() => {
                            const shown =
                              importFilter === "all"
                                ? importRows
                                : importRows.filter(
                                    (r) => r.status === importFilter,
                                  );

                            if (shown.length === 0) {
                              return (
                                <div className="p-6 text-sm text-slate-600">
                                  No rows match this filter.
                                </div>
                              );
                            }

                            return (
                              <div className="divide-y">
                                {shown.map((r) => (
                                  <div
                                    key={r.id}
                                    className="grid grid-cols-12 items-start gap-2 px-5 py-4 text-sm"
                                  >
                                    {/* Row + status */}
                                    <div className="col-span-1 text-slate-600">
                                      {r.row_index}
                                      <div className="mt-1">
                                        <span
                                          className={[
                                            "inline-flex rounded-full border px-2 py-0.5 text-[11px]",
                                            r.status === "ready"
                                              ? "bg-emerald-50 text-emerald-700"
                                              : r.status === "blocked"
                                                ? "bg-red-50 text-red-700"
                                                : "bg-amber-50 text-amber-800",
                                          ].join(" ")}
                                        >
                                          {r.status}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Date */}
                                    <div className="col-span-2">
                                      <input
                                        type="date"
                                        className="w-full rounded-xl border px-3 py-2 text-sm"
                                        value={r.expense_date ?? ""}
                                        onChange={(e) =>
                                          patchImportRowLocal(r.id, {
                                            expense_date:
                                              e.target.value || null,
                                          })
                                        }
                                      />
                                      <div className="mt-1 text-[11px] text-slate-500">
                                        blank = default month
                                      </div>
                                    </div>

                                    {/* Category */}
                                    <div className="col-span-2">
                                      <select
                                        className="w-full rounded-xl border px-3 py-2 text-sm"
                                        value={r.expense_category_id ?? ""}
                                        onChange={(e) =>
                                          patchImportRowLocal(r.id, {
                                            expense_category_id:
                                              e.target.value || null,
                                          })
                                        }
                                      >
                                        <option value="">— Select —</option>
                                        {expenseCats.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Description + vendor */}
                                    <div className="col-span-3">
                                      <input
                                        className="w-full rounded-xl border px-3 py-2 text-sm"
                                        value={r.description}
                                        onChange={(e) =>
                                          patchImportRowLocal(r.id, {
                                            description: e.target.value,
                                          })
                                        }
                                        placeholder="Description"
                                      />
                                      <div className="mt-2">
                                        <input
                                          className="w-full rounded-xl border px-3 py-2 text-sm"
                                          value={r.vendor ?? ""}
                                          onChange={(e) =>
                                            patchImportRowLocal(r.id, {
                                              vendor: e.target.value || null,
                                            })
                                          }
                                          placeholder="Vendor (optional)"
                                        />
                                      </div>
                                    </div>

                                    {/* Amount */}
                                    <div className="col-span-1">
                                      <input
                                        className="w-full rounded-xl border px-3 py-2 text-sm"
                                        value={
                                          typeof r.amount_cents === "number"
                                            ? (r.amount_cents / 100).toFixed(2)
                                            : ""
                                        }
                                        onChange={(e) => {
                                          const cents = parseMoneyToCents(
                                            e.target.value,
                                          );
                                          patchImportRowLocal(r.id, {
                                            amount_cents:
                                              cents === null || cents <= 0
                                                ? null
                                                : cents,
                                          });
                                        }}
                                        placeholder="0.00"
                                      />
                                    </div>

                                    {/* Method + cheque */}
                                    <div className="col-span-1">
                                      <select
                                        className="w-full rounded-xl border px-3 py-2 text-sm"
                                        value={r.payment_method}
                                        onChange={(e) =>
                                          patchImportRowLocal(r.id, {
                                            payment_method: e.target
                                              .value as PaymentMethod,
                                          })
                                        }
                                      >
                                        <option value="cash">cash</option>
                                        <option value="cheque">cheque</option>
                                        <option value="online">online</option>
                                      </select>

                                      {r.payment_method === "cheque" ? (
                                        <input
                                          className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                                          value={r.cheque_number ?? ""}
                                          onChange={(e) =>
                                            patchImportRowLocal(r.id, {
                                              cheque_number:
                                                e.target.value || null,
                                            })
                                          }
                                          placeholder="Cheque #"
                                        />
                                      ) : null}
                                    </div>

                                    {/* Error */}
                                    <div className="col-span-2">
                                      {Array.isArray(r.errors) &&
                                      r.errors.length > 0 ? (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                          {r.errors.join("; ")}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-slate-500">
                                          —
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 text-xs text-slate-500">
                      Tip: Fix all “needs_review” rows until they become
                      “ready”, then click{" "}
                      <span className="font-semibold">Append ready rows</span>.
                    </div>
                  </>
                )}
              </div>

              {/* ================= Footer (fixed) ================= */}
              <div className="shrink-0 border-t px-6 py-4 flex items-center justify-between gap-3">
                <button
                  disabled={importBusy}
                  className={`rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 ${
                    importBusy ? "opacity-50 pointer-events-none" : ""
                  }`}
                  onClick={async () => {
                    void closeImportModal();
                  }}
                >
                  Close
                </button>

                {importStep === "upload" ? (
                  <div className="text-xs text-slate-500">
                    Upload a CSV to continue.
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {importDirty
                      ? "Save changes before appending."
                      : "Ready to append."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
