"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { useRouter } from "next/navigation";

/* ===================== Types ===================== */

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

type CategoryType = "income" | "expense" | "services";
type PaymentMethod = "cash" | "cheque" | "online";

type CategoryRow = {
  id: string;
  name: string;
  type: CategoryType;
  status: "active" | "archived";
};

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: "active" | "archived";
  gender?: "male" | "female";
  age_group?: "1-12" | "13-17" | "18-35" | "36+";
  segment?: "men" | "women" | "boys" | "girls";
};

type DraftBatch = {
  id: string;
  org_id: string;
  service_category_id: string;
  session_date: string; // YYYY-MM-DD
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
  member_id: string;
  income_category_id: string;
  payment_method: PaymentMethod;
  cheque_number: string | null;
  amount_cents: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ImportStep = "upload" | "review";
type ImportFilter = "all" | "needs_review" | "ready" | "blocked";

type ImportIncomeRow = {
  id: string;
  row_index: number;

  // Raw text from CSV (never blank this)
  member_name: string; // always shown
  category_name: string; // always shown

  // Resolved IDs (user can fix in review)
  member_id: string | null;
  income_category_id: string | null;

  amount_cents: number | null;

  payment_method: PaymentMethod;
  cheque_number: string | null;

  status: "needs_review" | "ready" | "blocked";
  errors: string[];

  member_match_query?: string;
  member_match_open?: boolean;
};

/* ===================== Shared helpers (File 2) ===================== */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;

  // Some libs throw strings
  if (typeof err === "string") return err;

  // Best-effort for unknown objects
  if (typeof err === "object" && err !== null) {
    // Try common shapes: { message: string }
    const maybe = err as { message?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
  }

  return "Unknown error";
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
  const cents = Math.round(num * 100);
  return cents;
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

/* ===================== Small UI helpers (File 2) ===================== */

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
      <div className="rounded-2xl border bg-primary/10 bg-white px-4 py-3 text-sm shadow-lg">
        {text}
      </div>
    </div>
  );
}

/* ===================== Page ===================== */

export default function IncomePage() {
  const orgId = getActiveOrgId();
  const router = useRouter();

  /* ---------- Role + permissions ---------- */
  const [role, setRole] = useState<Role | null>(null);
  const isFinance = role === "finance" || role === "admin" || role === "owner";

  /* ---------- Quick-add income category modal ---------- */
  const [quickIncomeCatOpen, setQuickIncomeCatOpen] = useState(false);
  const [qicName, setQicName] = useState("");
  const [qicSaving, setQicSaving] = useState(false);
  const [qicErr, setQicErr] = useState("");

  /* ---------- Reference data ---------- */
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [incomeCats, setIncomeCats] = useState<CategoryRow[]>([]);
  const [serviceCats, setServiceCats] = useState<CategoryRow[]>([]);

  /* ---------- Draft batches ---------- */
  const [batches, setBatches] = useState<DraftBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  /* ---------- Draft items for selected batch ---------- */
  const [items, setItems] = useState<DraftItem[]>([]);

  /* ---------- Global page load ---------- */
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* ---------- Toast ---------- */
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("");

  /* ---------- Create batch modal ---------- */
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchServiceId, setBatchServiceId] = useState<string>("");
  const [batchDate, setBatchDate] = useState<string>("");

  /* ---------- Add/Edit item modal ---------- */
  const [itemOpen, setItemOpen] = useState(false);
  const [itemMode, setItemMode] = useState<"create" | "edit">("create");
  const [editItemId, setEditItemId] = useState<string | null>(null);

  const [memberId, setMemberId] = useState<string>("");
  const [incomeCategoryId, setIncomeCategoryId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [chequeNumber, setChequeNumber] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const [savingItem, setSavingItem] = useState(false);
  const [itemErr, setItemErr] = useState("");

  /* ---------- Publish state ---------- */
  const [publishing, setPublishing] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  /* ---------- Quick-add member modal ---------- */
  const [quickMemberOpen, setQuickMemberOpen] = useState(false);
  const [qmFirst, setQmFirst] = useState("");
  const [qmLast, setQmLast] = useState("");
  const [qmGender, setQmGender] = useState<"male" | "female" | "">("");
  const [qmAgeGroup, setQmAgeGroup] = useState<
    "1-12" | "13-17" | "18-35" | "36+" | ""
  >("");
  const [qmSaving, setQmSaving] = useState(false);
  const [qmErr, setQmErr] = useState("");

  /* ---------- Typeahead: Member ---------- */
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSuggestOpen, setMemberSuggestOpen] = useState(false);
  const clearedOnFocusRef = useRef(false);

  /* ---------- Typeahead: Income category ---------- */
  const [incomeCatQuery, setIncomeCatQuery] = useState("");
  const [incomeCatSuggestOpen, setIncomeCatSuggestOpen] = useState(false);
  const clearedIncomeCatOnFocusRef = useRef(false);
  const [qmRowId, setQmRowId] = useState<string | null>(null);

  /* ===================== Derived maps/memos (File 2 logic preserved) ===================== */

  const incomeCatLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of incomeCats) map.set(c.id, c.name);
    return map;
  }, [incomeCats]);

  const incomeCatIdByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of incomeCats) map.set(c.name.toLowerCase(), c.id);
    return map;
  }, [incomeCats]);

  const filteredIncomeCats = useMemo(() => {
    const needle = incomeCatQuery.trim().toLowerCase();
    if (!needle) return incomeCats.slice(0, 8);
    return incomeCats
      .filter((c) => c.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [incomeCatQuery, incomeCats]);

  const exactIncomeCatMatchId = useMemo(() => {
    const id = incomeCatIdByLabel.get(incomeCatQuery.trim().toLowerCase());
    return id ?? null;
  }, [incomeCatQuery, incomeCatIdByLabel]);

  const showAddIncomeCatRow = useMemo(() => {
    const q = incomeCatQuery.trim();
    if (q.length < 2) return false;
    return !exactIncomeCatMatchId;
  }, [incomeCatQuery, exactIncomeCatMatchId]);

  const memberLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, `${m.first_name} ${m.last_name}`);
    return map;
  }, [members]);

  const memberIdByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members)
      map.set(`${m.first_name} ${m.last_name}`.toLowerCase(), m.id);
    return map;
  }, [members]);

  const filteredMembers = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase();
    if (!needle) return members.slice(0, 8);
    return members
      .filter((m) =>
        `${m.first_name} ${m.last_name}`.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [memberQuery, members]);

  const exactMemberMatchId = useMemo(() => {
    const id = memberIdByLabel.get(memberQuery.trim().toLowerCase());
    return id ?? null;
  }, [memberQuery, memberIdByLabel]);

  const showAddMemberRow = useMemo(() => {
    const q = memberQuery.trim();
    if (q.length < 2) return false;
    return !exactMemberMatchId;
  }, [memberQuery, exactMemberMatchId]);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  const draftCount = useMemo(
    () => batches.filter((b) => b.status === "draft").length,
    [batches],
  );

  const batchSummary = useMemo(() => {
    const cents = items.reduce((sum, it) => sum + it.amount_cents, 0);
    return { count: items.length, cents };
  }, [items]);

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of serviceCats) map.set(c.id, c.name);
    return map;
  }, [serviceCats]);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, `${m.first_name} ${m.last_name}`);
    return map;
  }, [members]);

  const incomeCatNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of incomeCats) map.set(c.id, c.name);
    return map;
  }, [incomeCats]);

  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("upload");
  const [importFilter, setImportFilter] = useState<ImportFilter>("all");

  const [importRows, setImportRows] = useState<ImportIncomeRow[]>([]);
  const [importErr, setImportErr] = useState("");

  const [importDirty, setImportDirty] = useState(false);
  const [importSavedAt, setImportSavedAt] = useState<string | null>(null);

  const [savingImport, setSavingImport] = useState(false);
  const [appendingImport, setAppendingImport] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const topXRef = useRef<HTMLDivElement | null>(null);
  const botXRef = useRef<HTMLDivElement | null>(null);
  const [scrollWidth, setScrollWidth] = useState<number>(0);

  const isUpload = importStep === "upload";

  function nowTimeLabel() {
    const dt = new Date();
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function safeId() {
    // Works in modern browsers. If crypto isn’t available, fallback.
    try {
      return crypto.randomUUID();
    } catch {
      return `r_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
  }

  function normalizeMethod(raw: string | null | undefined): PaymentMethod {
    const v = (raw ?? "").trim().toLowerCase();
    if (v === "cash") return "cash";
    if (v === "cheque" || v === "check") return "cheque";
    if (v === "online" || v === "card" || v === "transfer") return "online";
    return "online"; // default
  }

  // Minimal CSV parser: handles quoted fields and commas in quotes.
  function parseCsvText(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          const next = text[i + 1];
          if (next === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === ",") {
        row.push(cur);
        cur = "";
        continue;
      }

      if (ch === "\n") {
        row.push(cur);
        cur = "";
        // strip trailing \r
        if (row.length === 1 && row[0].trim() === "") {
          row = [];
          continue;
        }
        rows.push(row.map((c) => c.replace(/\r$/, "")));
        row = [];
        continue;
      }

      cur += ch;
    }

    // last cell
    row.push(cur);
    if (row.some((c) => c.trim() !== ""))
      rows.push(row.map((c) => c.replace(/\r$/, "")));

    return rows;
  }

  function normalizeHeader(h: string) {
    return h.trim().toLowerCase().replace(/\s+/g, "_");
  }

  function getHeaderIndexMap(headers: string[]) {
    const map = new Map<string, number>();
    headers.forEach((h, idx) => map.set(normalizeHeader(h), idx));
    return map;
  }

  function computeImportRow(
    row_index: number,
    member_name_raw: string,
    category_name_raw: string,
    amount_raw: string,
    method_raw?: string,
    cheque_raw?: string,
  ): ImportIncomeRow {
    const member_name = (member_name_raw ?? "").trim();
    const category_name = (category_name_raw ?? "").trim();

    // Try resolve member by exact "First Last"
    const memberId = memberIdByLabel.get(member_name.toLowerCase()) ?? null;

    // Try resolve income category by exact name
    const catId = incomeCatIdByLabel.get(category_name.toLowerCase()) ?? null;

    const centsMaybe = parseMoneyToCents(amount_raw ?? "");
    const amount_cents = centsMaybe === null ? null : Math.abs(centsMaybe);

    const payment_method = normalizeMethod(method_raw);
    const cheque_number =
      payment_method === "cheque" ? (cheque_raw ?? "").trim() || null : null;

    const errors: string[] = [];

    // Member validation: required to append
    if (member_name && !memberId) errors.push("Member not found (select one)");

    // Category validation: required to append
    if (!catId) {
      if (!category_name) errors.push("Select a category");
      else errors.push("Category not found (select one)");
    }

    // Amount validation
    if (amount_cents === null) errors.push("Invalid amount");
    else if (amount_cents <= 0) errors.push("Amount must be > 0");

    // Cheque validation
    if (payment_method === "cheque" && !cheque_number) {
      errors.push("Cheque # required for cheque");
    }

    // Status rules:
    // - blocked: fundamental issues (missing amount, missing member name/category name)
    // - needs_review: name/category present but unresolved IDs, or cheque # missing for cheque
    // - ready: no errors
    const hasMissingCore = amount_cents === null;

    let status: ImportIncomeRow["status"] = "ready";
    if (errors.length === 0) status = "ready";
    else if (hasMissingCore) status = "blocked";
    else status = "needs_review";

    return {
      id: safeId(),
      row_index,
      member_name,
      category_name,
      member_id: memberId,
      income_category_id: catId,
      amount_cents,
      payment_method,
      cheque_number,
      status,
      errors,

      member_match_query: memberId
        ? (memberLabelById.get(memberId) ?? member_name)
        : "",
      member_match_open: false,
    };
  }

  function recomputeRow(r: ImportIncomeRow): ImportIncomeRow {
    const errors: string[] = [];

    const member_name = (r.member_name ?? "").trim();
    const category_name = (r.category_name ?? "").trim();

    const member_id = r.member_id;
    const income_category_id = r.income_category_id;

    if (member_name && !member_id) errors.push("Member not found (select one)");

    // Category is valid if income_category_id is selected, even if category_name is blank.
    if (!income_category_id) {
      if (!category_name) errors.push("Select a category");
      else errors.push("Category not found (select one)");
    }

    if (typeof r.amount_cents !== "number") errors.push("Invalid amount");
    else if (r.amount_cents <= 0) errors.push("Amount must be > 0");

    if (r.payment_method === "cheque" && !r.cheque_number) {
      errors.push("Cheque # required for cheque");
    }

    const hasMissingCore =
      !income_category_id || typeof r.amount_cents !== "number";

    let status: ImportIncomeRow["status"] = "ready";
    if (errors.length === 0) status = "ready";
    else if (hasMissingCore) status = "blocked";
    else status = "needs_review";

    return { ...r, member_name, category_name, errors, status };
  }

  function patchImportRowLocal(id: string, patch: Partial<ImportIncomeRow>) {
    setImportRows((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;

        const merged: ImportIncomeRow = { ...r, ...patch };

        // If user edits member_name, attempt auto-match
        if (patch.member_name !== undefined) {
          const needle = merged.member_name.trim().toLowerCase();
          merged.member_id = memberIdByLabel.get(needle) ?? null;
        }

        // If user edits category_name, attempt auto-match
        if (patch.category_name !== undefined) {
          const needle = merged.category_name.trim().toLowerCase();
          merged.income_category_id = incomeCatIdByLabel.get(needle) ?? null;
        }

        // If method changes away from cheque, clear cheque_number
        if (
          patch.payment_method !== undefined &&
          patch.payment_method !== "cheque"
        ) {
          merged.cheque_number = null;
        }

        return recomputeRow(merged);
      });

      return next;
    });

    setImportDirty(true);
  }

  async function onPickCsvFile(file: File) {
    if (!selectedBatch || selectedBatch.status !== "draft") {
      setImportErr("Select a draft batch to import into.");
      return;
    }

    setImportBusy(true);
    setImportErr("");

    try {
      const text = await file.text();
      const grid = parseCsvText(text);

      if (grid.length < 2) {
        setImportErr("CSV seems empty.");
        setImportBusy(false);
        return;
      }

      const headers = grid[0].map((h) => h.trim());
      const hmap = getHeaderIndexMap(headers);

      // Required headers (income):
      // member, category, amount
      const memberIdx =
        hmap.get("member") ??
        hmap.get("member_name") ??
        hmap.get("name") ??
        hmap.get("description");

      const catIdx =
        hmap.get("category") ??
        hmap.get("income_category") ??
        hmap.get("income_category_name");
      const amtIdx = hmap.get("amount") ?? hmap.get("amount_cents");

      if (
        memberIdx === undefined ||
        catIdx === undefined ||
        amtIdx === undefined
      ) {
        setImportErr(
          `Missing required headers. Required: member, category, amount. (Found: ${headers.join(
            ", ",
          )})`,
        );
        setImportBusy(false);
        return;
      }

      const methodIdx = hmap.get("method") ?? hmap.get("payment_method");
      const chequeIdx = hmap.get("cheque_number") ?? hmap.get("cheque");

      const rows: ImportIncomeRow[] = [];

      for (let i = 1; i < grid.length; i++) {
        const cells = grid[i];
        // skip fully empty lines
        if (!cells || cells.every((c) => (c ?? "").trim() === "")) continue;

        const member = cells[memberIdx] ?? "";
        const cat = cells[catIdx] ?? "";
        const amt = cells[amtIdx] ?? "";

        const method = methodIdx !== undefined ? (cells[methodIdx] ?? "") : "";
        const cheque = chequeIdx !== undefined ? (cells[chequeIdx] ?? "") : "";

        rows.push(
          computeImportRow(
            i, // row_index aligns to CSV line (excluding header = row 1)
            String(member ?? ""),
            String(cat ?? ""),
            String(amt ?? ""),
            String(method ?? ""),
            String(cheque ?? ""),
          ),
        );
      }

      if (rows.length === 0) {
        setImportErr("No data rows found.");
        setImportBusy(false);
        return;
      }

      setImportRows(rows);
      setImportStep("review");
      setImportFilter("all");
      setImportDirty(false);
      setImportSavedAt(null);
    } catch (e: unknown) {
      setImportErr(getErrorMessage(e) || "Failed to read CSV.");
    } finally {
      setImportBusy(false);
    }
  }

  function openImportModal() {
    setImportErr("");
    setImportStep("upload");
    setImportFilter("all");
    setImportRows([]);
    setImportDirty(false);
    setImportSavedAt(null);
    setImportOpen(true);
  }

  async function closeImportModal() {
    if (importBusy || savingImport || appendingImport) return;
    setImportOpen(false);

    // Reset state so next open is clean
    setImportErr("");
    setImportStep("upload");
    setImportFilter("all");
    setImportRows([]);
    setImportDirty(false);
    setImportSavedAt(null);
  }

  async function abandonImportJob() {
    if (importBusy || savingImport || appendingImport) return;
    setImportStep("upload");
    setImportFilter("all");
    setImportRows([]);
    setImportDirty(false);
    setImportSavedAt(null);
    setImportErr("");
  }

  async function saveImportChanges() {
    // Local “save” consistent with your UX. (No staging table)
    setSavingImport(true);
    try {
      setImportSavedAt(nowTimeLabel());
      setImportDirty(false);
    } finally {
      setSavingImport(false);
    }
  }

  const readyCount = useMemo(
    () => importRows.filter((r) => r.status === "ready").length,
    [importRows],
  );

  const canAppend = useMemo(() => {
    if (importDirty) return false;
    if (readyCount === 0) return false;
    if (!selectedBatch || selectedBatch.status !== "draft") return false;
    return true;
  }, [importDirty, readyCount, selectedBatch]);

  async function appendReadyRows() {
    if (!orgId || !selectedBatchId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") {
      setImportErr("Select a draft batch to append into.");
      return;
    }
    if (importDirty) {
      setImportErr("Save changes before appending.");
      return;
    }

    const ready = importRows.filter((r) => r.status === "ready");
    if (ready.length === 0) {
      setImportErr("No ready rows to append.");
      return;
    }

    // Double safety: ensure IDs exist
    const bad = ready.find(
      (r) =>
        !r.member_id ||
        !r.income_category_id ||
        typeof r.amount_cents !== "number" ||
        r.amount_cents <= 0 ||
        (r.payment_method === "cheque" && !r.cheque_number),
    );
    if (bad) {
      setImportErr(
        "Some rows are marked ready but still incomplete. Please review.",
      );
      return;
    }

    setAppendingImport(true);
    setImportErr("");

    const payload = ready.map((r) => ({
      org_id: orgId,
      batch_id: selectedBatchId,
      member_id: r.member_id as string,
      income_category_id: r.income_category_id as string,
      payment_method: r.payment_method,
      cheque_number: r.payment_method === "cheque" ? r.cheque_number : null,
      amount_cents: r.amount_cents as number,
    }));

    const { error } = await supabase.from("income_draft_items").insert(payload);

    if (error) {
      setImportErr(error.message);
      setAppendingImport(false);
      return;
    }

    // Refresh view
    await loadAll();
    await loadItems(selectedBatchId);

    setAppendingImport(false);
    showToast(`Appended ${ready.length} rows`);

    // Keep modal open, but mark that there are no pending changes; user can close.
    setImportRows([]);
    setImportStep("upload");
    setImportDirty(false);
    setImportSavedAt(null);
  }

  /* ===================== Loaders (File 2 logic preserved) ===================== */

  const loadAll = useCallback(async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    const myRole = await getMyRoleForOrg(orgId);
    setRole(myRole);

    const [membersRes, catsRes, batchesRes] = await Promise.all([
      supabase
        .from("members")
        .select("id,first_name,last_name,status,gender,age_group,segment")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true }),
      supabase
        .from("categories")
        .select("id,name,type,status")
        .eq("org_id", orgId)
        .eq("status", "active")
        .in("type", ["income", "services"])
        .order("name", { ascending: true }),
      supabase
        .from("income_draft_batches")
        .select(
          "id,org_id,service_category_id,session_date,status,created_by,created_at,updated_at,posted_by,posted_at",
        )
        .eq("org_id", orgId)
        .eq("status", "draft")
        .order("updated_at", { ascending: false }),
    ]);

    if (membersRes.error) {
      setErr(membersRes.error.message);
      setLoading(false);
      return;
    }
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

    const cats = (catsRes.data ?? []) as CategoryRow[];
    setIncomeCats(cats.filter((c) => c.type === "income"));
    setServiceCats(cats.filter((c) => c.type === "services"));
    setMembers((membersRes.data ?? []) as MemberRow[]);

    const bs = (batchesRes.data ?? []) as DraftBatch[];
    setBatches(bs);

    if (!selectedBatchId && bs.length > 0) setSelectedBatchId(bs[0].id);

    setLoading(false);
  }, [orgId, selectedBatchId]);

  const loadItems = useCallback(
    async (batchId: string) => {
      if (!orgId) return;

      const res = await supabase
        .from("income_draft_items")
        .select(
          "id,org_id,batch_id,member_id,income_category_id,payment_method,cheque_number,amount_cents,created_by,created_at,updated_at",
        )
        .eq("org_id", orgId)
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true });

      if (res.error) {
        setErr(res.error.message);
        setItems([]);
        return;
      }

      setItems((res.data ?? []) as DraftItem[]);
    },
    [orgId],
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const top = topXRef.current;
    const bot = botXRef.current;
    if (!top || !bot) return;

    // Set fake width to match real content width
    setScrollWidth(bot.scrollWidth);

    let syncing = false;

    const syncTop = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = bot.scrollLeft;
      syncing = false;
    };

    const syncBot = () => {
      if (syncing) return;
      syncing = true;
      bot.scrollLeft = top.scrollLeft;
      syncing = false;
    };

    bot.addEventListener("scroll", syncTop);
    top.addEventListener("scroll", syncBot);

    return () => {
      bot.removeEventListener("scroll", syncTop);
      top.removeEventListener("scroll", syncBot);
    };
  }, [importRows.length, importFilter]);

  useEffect(() => {
    if (selectedBatchId) void loadItems(selectedBatchId);
    else setItems([]);
  }, [selectedBatchId, loadItems]);

  /* ===================== Toast helper ===================== */

  const showToast = useCallback((t: string) => {
    setToastText(t);
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
  }, []);

  /* ===================== File 2 actions (kept) ===================== */

  const openCreateBatch = useCallback(() => {
    setErr("");
    setBatchServiceId(serviceCats[0]?.id ?? "");
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setBatchDate(`${yyyy}-${mm}-${dd}`);
    setBatchOpen(true);
  }, [serviceCats]);

  /* ===================== Guards (no anys) ===================== */

  function isGender(v: string): v is "male" | "female" {
    return v === "male" || v === "female";
  }

  function isAgeGroup(v: string): v is "1-12" | "13-17" | "18-35" | "36+" {
    return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
  }

  /* ===================== Batch actions ===================== */

  async function createBatch(): Promise<void> {
    if (!orgId) return;
    if (!batchServiceId || !batchDate) {
      setErr("Select a service and date.");
      return;
    }
    if (draftCount >= 10) return;

    setErr("");
    const { data: sessionRes } = await supabase.auth.getSession();
    const userId = sessionRes.session?.user?.id;
    if (!userId) {
      setErr("Not signed in.");
      return;
    }

    const { data, error } = await supabase
      .from("income_draft_batches")
      .insert({
        org_id: orgId,
        service_category_id: batchServiceId,
        session_date: batchDate,
        status: "draft",
        created_by: userId,
      })
      .select(
        "id,org_id,service_category_id,session_date,status,created_by,created_at,updated_at,posted_by,posted_at",
      )
      .single();

    if (error) {
      setErr(error.message);
      return;
    }

    setBatchOpen(false);
    showToast("Draft batch created");

    // refresh list + select new
    await loadAll();
    if (data?.id) setSelectedBatchId(data.id);
  }

  async function deleteDraftBatch(batchId: string): Promise<void> {
    if (!orgId) return;

    const b = batches.find((x) => x.id === batchId);
    if (!b) return;
    if (b.status !== "draft") {
      showToast("Only draft batches can be deleted");
      return;
    }

    const ok = window.confirm(
      "Delete this draft batch? This cannot be undone.",
    );
    if (!ok) return;

    const { error } = await supabase
      .from("income_draft_batches")
      .delete()
      .eq("org_id", orgId)
      .eq("id", batchId)
      .eq("status", "draft");

    if (error) {
      setErr(error.message);
      return;
    }

    showToast("Draft deleted");

    // if selected batch deleted, select next
    if (selectedBatchId === batchId) {
      setSelectedBatchId(null);
      setItems([]);
    }

    await loadAll();
  }

  async function publishBatch(): Promise<void> {
    if (!orgId) return;
    if (!selectedBatch) return;
    if (selectedBatch.status !== "draft") return;

    if (!isFinance) {
      showToast("Finance/Admin only");
      return;
    }

    if (items.length === 0) {
      setErr("Add at least one item before publishing.");
      return;
    }

    const ok = window.confirm(
      "Publish this draft batch? Published batches are locked.",
    );
    if (!ok) return;

    setPublishing(true);
    setErr("");

    try {
      // === Option A: RPC (recommended) ===
      // Replace this name/args if your RPC differs.
      const { error } = await supabase.rpc("publish_income_batch", {
        p_org_id: orgId,
        p_batch_id: selectedBatch.id,
      });

      if (error) {
        // === Option B: If you don't have RPC, at minimum lock the batch ===
        // (but you'd still need server-side to move rows to ledger)
        setErr(error.message);
        return;
      }

      showToast("Published");
      await loadAll();
      await loadItems(selectedBatch.id);
    } finally {
      setPublishing(false);
    }
  }

  /* ===================== Item modal open/close ===================== */

  function resetItemForm(): void {
    setMemberId("");
    setMemberQuery("");
    setMemberSuggestOpen(false);

    setIncomeCategoryId("");
    setIncomeCatQuery("");
    setIncomeCatSuggestOpen(false);

    setPaymentMethod("cash");
    setChequeNumber("");
    setAmount("");

    setItemErr("");
    setEditItemId(null);
  }

  function openAddItem(): void {
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    setItemMode("create");
    resetItemForm();
    setItemOpen(true);

    // focus amount after opening is handled by ref in UI if you like
    window.setTimeout(() => amountRef.current?.focus(), 50);
  }

  function openEditItem(it: DraftItem): void {
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    setItemMode("edit");
    setEditItemId(it.id);

    setMemberId(it.member_id);
    setMemberQuery(memberNameById.get(it.member_id) ?? "");
    setMemberSuggestOpen(false);

    setIncomeCategoryId(it.income_category_id);
    setIncomeCatQuery(incomeCatNameById.get(it.income_category_id) ?? "");
    setIncomeCatSuggestOpen(false);

    setPaymentMethod(it.payment_method);
    setChequeNumber(it.cheque_number ?? "");
    setAmount((it.amount_cents / 100).toFixed(2));

    setItemErr("");
    setItemOpen(true);

    window.setTimeout(() => amountRef.current?.focus(), 50);
  }

  /* ===================== Item actions ===================== */

  async function saveItem(): Promise<void> {
    if (!orgId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    // Validation consistent with File 2 behavior
    if (!memberId) {
      setItemErr("Select a valid member.");
      return;
    }
    if (!incomeCategoryId) {
      setItemErr("Select a valid income category.");
      return;
    }
    const cents = parseMoneyToCents(amount);
    if (cents === null || Math.abs(cents) <= 0) {
      setItemErr("Enter a valid amount.");
      return;
    }
    if (paymentMethod === "cheque" && !chequeNumber.trim()) {
      setItemErr("Cheque number is required for cheque payments.");
      return;
    }

    setSavingItem(true);
    setItemErr("");

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const userId = sessionRes.session?.user?.id;
      if (!userId) {
        setItemErr("Not signed in.");
        return;
      }

      if (itemMode === "create") {
        const { error } = await supabase.from("income_draft_items").insert({
          org_id: orgId,
          batch_id: selectedBatch.id,
          member_id: memberId,
          income_category_id: incomeCategoryId,
          payment_method: paymentMethod,
          cheque_number:
            paymentMethod === "cheque" ? chequeNumber.trim() : null,
          amount_cents: Math.abs(cents),
          created_by: userId,
        });

        if (error) {
          setItemErr(error.message);
          return;
        }

        showToast("Added");
      } else {
        if (!editItemId) return;

        const { error } = await supabase
          .from("income_draft_items")
          .update({
            member_id: memberId,
            income_category_id: incomeCategoryId,
            payment_method: paymentMethod,
            cheque_number:
              paymentMethod === "cheque" ? chequeNumber.trim() : null,
            amount_cents: Math.abs(cents),
          })
          .eq("org_id", orgId)
          .eq("id", editItemId)
          .eq("batch_id", selectedBatch.id);

        if (error) {
          setItemErr(error.message);
          return;
        }

        showToast("Updated");
      }

      setItemOpen(false);
      resetItemForm();
      await loadItems(selectedBatch.id);
      await loadAll(); // keep batch list "updated_at" fresh
    } finally {
      setSavingItem(false);
    }
  }

  async function removeItem(itemId: string): Promise<void> {
    if (!orgId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    const ok = window.confirm("Remove this line?");
    if (!ok) return;

    const { error } = await supabase
      .from("income_draft_items")
      .delete()
      .eq("org_id", orgId)
      .eq("batch_id", selectedBatch.id)
      .eq("id", itemId);

    if (error) {
      setErr(error.message);
      return;
    }

    showToast("Removed");
    await loadItems(selectedBatch.id);
    await loadAll();
  }

  /* ===================== Quick-add member hooks ===================== */

  function openQuickAddMemberFromQuery(query: string, rowId?: string): void {
    const trimmed = query.trim();

    // best-effort: split "First Last"
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "";
    const last = parts.slice(1).join(" ");

    setQmFirst(first);
    setQmLast(last);
    setQmGender("");
    setQmAgeGroup("");
    setQmErr("");

    setQmRowId(rowId ?? null);
    setQuickMemberOpen(true);
  }

  async function saveQuickMember(): Promise<void> {
    if (!orgId) return;

    const first = qmFirst.trim();
    const last = qmLast.trim();

    if (!first || !last) {
      setQmErr("First name and last name are required.");
      return;
    }
    if (!qmGender || !isGender(qmGender)) {
      setQmErr("Select gender.");
      return;
    }
    if (!qmAgeGroup || !isAgeGroup(qmAgeGroup)) {
      setQmErr("Select age group.");
      return;
    }

    setQmSaving(true);
    setQmErr("");

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const userId = sessionRes.session?.user?.id;
      if (!userId) {
        setQmErr("Not signed in.");
        return;
      }

      const { data, error } = await supabase
        .from("members")
        .insert({
          org_id: orgId,
          first_name: first,
          last_name: last,
          status: "active",
          gender: qmGender,
          age_group: qmAgeGroup,
          created_by: userId,
        })
        .select("id,first_name,last_name,status,gender,age_group,segment")
        .single();

      if (error) {
        setQmErr(error.message);
        return;
      }

      showToast("Member added");

      // Close modal early for snappy UX
      setQuickMemberOpen(false);

      // Refresh members list so dropdowns / maps are up-to-date
      await loadAll();

      if (data?.id) {
        const label = `${data.first_name} ${data.last_name}`.trim();

        if (qmRowId) {
          patchImportRowLocal(qmRowId, {
            member_id: data.id,
            member_match_query: label,
            member_match_open: false,
          });
        } else {
          // Fallback: your original single-item modal behavior
          setMemberId(data.id);
          setMemberQuery(label);
          setMemberSuggestOpen(false);
          setItemErr("");
        }
      }
    } finally {
      setQmSaving(false);
      setQmRowId(null);
    }
  }

  /* ===================== Quick-add income category hooks ===================== */

  function openQuickAddIncomeCategoryFromQuery(query: string): void {
    const trimmed = query.trim();
    setQicName(trimmed);
    setQicErr("");
    setQuickIncomeCatOpen(true);
  }

  async function saveQuickIncomeCategory(): Promise<void> {
    if (!orgId) return;

    const name = qicName.trim();
    if (name.length < 2) {
      setQicErr("Enter a category name.");
      return;
    }

    setQicSaving(true);
    setQicErr("");

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const userId = sessionRes.session?.user?.id;
      if (!userId) {
        setQicErr("Not signed in.");
        return;
      }

      const { data, error } = await supabase
        .from("categories")
        .insert({
          org_id: orgId,
          name,
          type: "income",
          status: "active",
          created_by: userId,
        })
        .select("id,name,type,status")
        .single();

      if (error) {
        setQicErr(error.message);
        return;
      }

      showToast("Category added");
      setQuickIncomeCatOpen(false);

      // refresh list + select in item modal
      await loadAll();
      if (data?.id) {
        setIncomeCategoryId(data.id);
        setIncomeCatQuery(data.name);
        setIncomeCatSuggestOpen(false);
        setItemErr("");
      }
    } finally {
      setQicSaving(false);
    }
  }

  return (
    <>
      <Toast show={toastOpen} text={toastText} />

      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Income</div>
            <div className="text-sm text-slate-600">
              Draft batches and publish to ledger
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
              onClick={() => router.push("/app/income/published")}
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
            </div>

            <div className="mt-4 space-y-5">
              {batches.length === 0 ? (
                <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                  No batches yet. Create a draft batch to start.
                </div>
              ) : (
                batches.map((b) => {
                  const active = b.id === selectedBatchId;
                  const sName =
                    serviceNameById.get(b.service_category_id) ?? "Service";
                  const label = `${sName} — ${fmtDate(b.session_date)}`;

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
                              {b.status === "draft" ? "Draft" : "Published"} •
                              Updated {fmtDate(b.updated_at)}
                            </div>
                          </div>
                          <div className="shrink-0">
                            <Pill>
                              {b.status === "draft" ? "Draft" : "Published"}
                            </Pill>
                          </div>
                        </div>
                      </button>

                      {isFinance && b.status === "draft" ? (
                        <div className="border-t px-4 py-2">
                          <button
                            className="w-full rounded-xl border px-3 py-2 text-xs hover:bg-slate-50"
                            onClick={() => void deleteDraftBatch(b.id)}
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
                Select a batch to view and edit items.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {serviceNameById.get(selectedBatch.service_category_id) ??
                        "Service"}{" "}
                      — {fmtDate(selectedBatch.session_date)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Status: {selectedBatch.status} • {batchSummary.count}{" "}
                      items • {formatMoney(batchSummary.cents)} (draft total)
                      {selectedBatch.status === "published" &&
                      selectedBatch.posted_at ? (
                        <> • Posted {fmtDate(selectedBatch.posted_at)}</>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {selectedBatch.status === "draft" ? (
                      <>
                        <button
                          className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                          onClick={openAddItem}
                        >
                          Add line
                        </button>

                        <button
                          className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                          onClick={openImportModal}
                          title={
                            !selectedBatch || selectedBatch.status !== "draft"
                              ? "Select a draft batch to import into"
                              : "Import income items from CSV"
                          }
                          disabled={
                            !selectedBatch || selectedBatch.status !== "draft"
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
                          onClick={() => void publishBatch()}
                          title={
                            !isFinance
                              ? "Finance/Admin only"
                              : "Publish this draft"
                          }
                        >
                          {publishing ? "Publishing…" : "Publish"}
                        </button>
                      </>
                    ) : (
                      <button
                        className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                        onClick={openCreateBatch}
                      >
                        New draft
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                  {selectedBatch.status === "draft"
                    ? "Add and edit draft items, then publish. Published entries become immutable."
                    : "This batch is published and locked. Add a new draft for missing people, or post a negative adjustment for corrections."}
                </div>

                {/* Items table */}
                <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-[1100px]">
                      <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100 rounded-t-3xl">
                        <div className="col-span-3">Member</div>
                        <div className="col-span-2">Category</div>
                        <div className="col-span-2">Amount</div>
                        <div className="col-span-1">Method</div>
                        <div className="col-span-1">Cheque #</div>
                        <div className="col-span-3 text-right">Actions</div>
                      </div>

                      {items.length === 0 ? (
                        <div className="p-6 text-sm text-slate-600">
                          No items in this batch yet.
                        </div>
                      ) : (
                        <div className="divide-y">
                          {items.map((it) => (
                            <div
                              key={it.id}
                              className="grid grid-cols-12 items-start px-5 py-4 text-sm"
                            >
                              <div className="col-span-3 min-w-0 font-semibold whitespace-normal break-words">
                                {memberNameById.get(it.member_id) ?? "—"}
                              </div>

                              <div className="col-span-2 min-w-0 text-slate-700 break-words">
                                {incomeCatNameById.get(it.income_category_id) ??
                                  "—"}
                              </div>

                              <div className="col-span-2 font-semibold">
                                {formatMoney(it.amount_cents)}
                              </div>

                              <div className="col-span-1 text-slate-700">
                                {it.payment_method}
                              </div>

                              <div className="col-span-1 min-w-0 text-slate-700 break-words">
                                {it.payment_method === "cheque"
                                  ? (it.cheque_number ?? "—")
                                  : "—"}
                              </div>

                              <div className="col-span-3 flex justify-end gap-2">
                                {selectedBatch.status === "draft" ? (
                                  <>
                                    <button
                                      className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                      onClick={() => openEditItem(it)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                      onClick={() => void removeItem(it.id)}
                                    >
                                      Remove
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    —
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {!isFinance && selectedBatch.status === "draft" ? (
                  <div className="mt-4 text-xs text-slate-500">
                    Anyone can add/edit drafts. Only Finance/Admin can publish.
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===================== Create batch modal ===================== */}
      {batchOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setBatchOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">New draft batch</div>
              <div className="text-xs text-slate-600">
                Choose a service and date. You can create another batch with the
                same service/date later.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Service *
                </div>
                <select
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={batchServiceId}
                  onChange={(e) => setBatchServiceId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {serviceCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Date *
                </div>
                <input
                  type="date"
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                />
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
                className="rounded-2xl border px-6 py-2 text-sm hover:bg-slate-50"
                onClick={() => setBatchOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-6 py-2 text-sm font-semibold text-white ${
                  draftCount >= 10
                    ? "bg-slate-300"
                    : "bg-primary hover:bg-primary/85"
                }`}
                disabled={draftCount >= 10}
                onClick={() => void createBatch()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===================== Add/Edit item modal ===================== */}
      {itemOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-6xl rounded-3xl bg-white shadow-xl flex flex-col overflow-hidden">
            <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">
                  {itemMode === "create"
                    ? "Add income line"
                    : "Edit income line"}
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

            <div className="max-h-[75vh] min-h-[35vh] overflow-auto px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {/* ================= Member ================= */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-600">
                      Member *
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      value={memberQuery}
                      onFocus={() => {
                        setMemberSuggestOpen(true);
                        if (!clearedOnFocusRef.current) {
                          clearedOnFocusRef.current = true;
                          setMemberQuery("");
                          setMemberId("");
                          setItemErr("");
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(
                          () => setMemberSuggestOpen(false),
                          120,
                        );
                        clearedOnFocusRef.current = false;
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMemberQuery(v);
                        setItemErr("");

                        const id = memberIdByLabel.get(v.trim().toLowerCase());
                        setMemberId(id ?? "");
                        setMemberSuggestOpen(true);
                      }}
                      placeholder="Type a name…"
                    />

                    {memberSuggestOpen ? (
                      <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-auto">
                        {filteredMembers.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-600">
                            No matches.
                          </div>
                        ) : (
                          filteredMembers.map((m) => {
                            const label = `${m.first_name} ${m.last_name}`;
                            return (
                              <button
                                type="button"
                                key={m.id}
                                className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setMemberId(m.id);
                                  setMemberQuery(label);
                                  setMemberSuggestOpen(false);
                                  setItemErr("");
                                }}
                              >
                                {label}
                              </button>
                            );
                          })
                        )}

                        {showAddMemberRow ? (
                          <div className="border-t">
                            <button
                              type="button"
                              className="block w-full px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() =>
                                openQuickAddMemberFromQuery(memberQuery)
                              }
                            >
                              + Add new member
                              {memberQuery.trim()
                                ? `: “${memberQuery.trim()}”`
                                : ""}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!memberId && memberQuery.trim().length > 0 ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Select a valid member (or add a new one).
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* ================= Income category ================= */}
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Income category *
                  </div>

                  <div className="relative">
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      value={incomeCatQuery}
                      onFocus={() => {
                        setIncomeCatSuggestOpen(true);
                        if (!clearedIncomeCatOnFocusRef.current) {
                          clearedIncomeCatOnFocusRef.current = true;
                          setIncomeCatQuery("");
                          setIncomeCategoryId("");
                          setItemErr("");
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(
                          () => setIncomeCatSuggestOpen(false),
                          120,
                        );
                        clearedIncomeCatOnFocusRef.current = false;
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setIncomeCatQuery(v);
                        setItemErr("");

                        const id = incomeCatIdByLabel.get(
                          v.trim().toLowerCase(),
                        );
                        setIncomeCategoryId(id ?? "");
                        setIncomeCatSuggestOpen(true);
                      }}
                      placeholder="Type a category…"
                    />

                    {incomeCatSuggestOpen ? (
                      <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-auto">
                        {filteredIncomeCats.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-600">
                            No matches.
                          </div>
                        ) : (
                          filteredIncomeCats.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setIncomeCategoryId(c.id);
                                setIncomeCatQuery(c.name);
                                setIncomeCatSuggestOpen(false);
                                setItemErr("");
                              }}
                            >
                              {c.name}
                            </button>
                          ))
                        )}

                        {showAddIncomeCatRow ? (
                          <div className="border-t">
                            <button
                              type="button"
                              className="block w-full px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() =>
                                openQuickAddIncomeCategoryFromQuery(
                                  incomeCatQuery,
                                )
                              }
                            >
                              + Add income category
                              {incomeCatQuery.trim()
                                ? `: “${incomeCatQuery.trim()}”`
                                : ""}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!incomeCategoryId && incomeCatQuery.trim().length > 0 ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Select a valid category (or add a new one).
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* ================= Method + cheque ================= */}
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

              {/* ================= Amount ================= */}
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
                  placeholder="e.g., 100.00"
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
                className="rounded-2xl border px-6 py-2 text-sm hover:bg-slate-50"
                onClick={() => setItemOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-6 py-2 text-sm font-semibold text-white ${
                  savingItem ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={savingItem}
                onClick={() => void saveItem()}
              >
                {savingItem ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===================== Quick-add Member modal ===================== */}
      {quickMemberOpen ? (
        <div
          className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setQuickMemberOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Add member</div>
              <div className="text-xs text-slate-600">
                Quick add without leaving Income.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    First name *
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={qmFirst}
                    onChange={(e) => setQmFirst(e.target.value)}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Last name *
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={qmLast}
                    onChange={(e) => setQmLast(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Gender *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={qmGender}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || isGender(v)) setQmGender(v);
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Age group *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={qmAgeGroup}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || isAgeGroup(v)) setQmAgeGroup(v);
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="1-12">1 to 12</option>
                    <option value="13-17">13 to 17</option>
                    <option value="18-35">18 to 35</option>
                    <option value="36+">36 and above</option>
                  </select>
                </div>
              </div>

              {qmErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {qmErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => {
                  setQuickMemberOpen(false);
                  setQmRowId(null);
                }}
              >
                Cancel
              </button>
              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  qmSaving ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={qmSaving}
                onClick={() => void saveQuickMember()}
              >
                {qmSaving ? "Saving…" : "Save member"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===================== Quick-add Income Category modal ===================== */}
      {quickIncomeCatOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setQuickIncomeCatOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Add income category</div>
              <div className="text-xs text-slate-600">
                Quick add without leaving Income.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Name *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={qicName}
                  onChange={(e) => {
                    setQicName(e.target.value);
                    setQicErr("");
                  }}
                  placeholder="e.g., Tithe, Offering…"
                  autoFocus
                />
              </div>

              {qicErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {qicErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setQuickIncomeCatOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  qicSaving ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={qicSaving}
                onClick={() => void saveQuickIncomeCategory()}
              >
                {qicSaving ? "Saving…" : "Save category"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Part 4: Import modals go here */}

      {/* ===================== Import CSV modal (FULL, scroll-proof) ===================== */}
      {importOpen ? (
        <div
          className="fixed inset-0 z-[70] bg-black/30"
          // onClick={() => {
          //   void (async () => {
          //     await closeImportModal();
          //   })();
          // }}
        >
          <div className="h-[100dvh] w-full p-4 flex items-center justify-center">
            <div
              className={[
                "w-full max-w-6xl rounded-3xl bg-white shadow-xl",
                "flex flex-col overflow-hidden",
                // Upload step: don't force full height
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
                    Import Income (CSV)
                  </div>
                  <div className="text-xs text-slate-600">
                    Upload a CSV → review rows → save changes → append ready
                    rows into the current draft batch.
                  </div>
                </div>

                <button
                  type="button"
                  disabled={importBusy || savingImport || appendingImport}
                  onClick={async () => {
                    await closeImportModal();
                  }}
                  className={`rounded-full p-1.5 ${
                    importBusy || savingImport || appendingImport
                      ? "text-slate-300"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                  aria-label="Close"
                  title={
                    importBusy || savingImport || appendingImport
                      ? "Please wait…"
                      : "Close"
                  }
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
                    <div className="lg:col-span-5 rounded-3xl border bg-slate-50 p-5 flex flex-col">
                      <div className="text-sm font-semibold">
                        Step 1 — Upload CSV
                      </div>

                      <div className="mt-1 text-xs text-slate-600">
                        Required headers:{" "}
                        <span className="font-semibold">
                          member, category, amount
                        </span>
                        . Optional: method, cheque_number.
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
                          <li>Negative amounts are made positive.</li>
                          <li>
                            Member must match an existing member name (or you’ll
                            select the right one during review).
                          </li>
                          <li>
                            Category must match an existing income category (or
                            you’ll select it during review).
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
                          id="income-import-csv"
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
                          htmlFor="income-import-csv"
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

                      <div className="mt-2 rounded-2xl border bg-white p-4 overflow-x-auto">
                        <div className="min-w-[900px] rounded-2xl border bg-white overflow-hidden">
                          <table className="w-full text-xs border-collapse">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="border px-3 py-2 text-left">
                                  member
                                </th>
                                <th className="border px-3 py-2 text-left">
                                  category
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
                                <td className="border px-3 py-2">John Doe</td>
                                <td className="border px-3 py-2">Tithe</td>
                                <td className="border px-3 py-2">120.50</td>
                                <td className="border px-3 py-2">cash</td>
                                <td className="border px-3 py-2"></td>
                              </tr>
                              <tr>
                                <td className="border px-3 py-2">Jane Smith</td>
                                <td className="border px-3 py-2">Offering</td>
                                <td className="border px-3 py-2">85.00</td>
                                <td className="border px-3 py-2">online</td>
                                <td className="border px-3 py-2"></td>
                              </tr>
                              <tr>
                                <td className="border px-3 py-2">Mark Brown</td>
                                <td className="border px-3 py-2">
                                  Thanksgiving
                                </td>
                                <td className="border px-3 py-2">34.99</td>
                                <td className="border px-3 py-2">cheque</td>
                                <td className="border px-3 py-2">103849</td>
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
                            <li>Fill in your income rows</li>
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
                            setImportFilter(e.target.value as ImportFilter)
                          }
                        >
                          <option value="all">All</option>
                          <option value="needs_review">Needs review</option>
                          <option value="ready">Ready</option>
                          <option value="blocked">Blocked</option>
                        </select>

                        <button
                          className={`rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 ${
                            importBusy || savingImport || appendingImport
                              ? "opacity-50 pointer-events-none"
                              : ""
                          }`}
                          onClick={async () => {
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
                          onClick={() => void appendReadyRows()}
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

                    {/* ================= Top horizontal scrollbar ================= */}
                    <div
                      ref={topXRef}
                      className="overflow-x-auto overflow-y-hidden h-4 mb-2"
                    >
                      {/* This div ONLY exists to create scroll width */}
                      <div style={{ width: scrollWidth }} className="h-1" />
                    </div>

                    {/* ================= Review table ================= */}
                    <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                      <div
                        ref={botXRef}
                        className="overflow-x-auto overflow-y-visible"
                      >
                        <div className="min-w-[1200px]">
                          <div className="sticky top-0 z-20 grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100">
                            <div className="col-span-1">Row</div>
                            <div className="col-span-3">Member match</div>

                            <div className="col-span-2">Category</div>
                            <div className="col-span-1">Amount</div>
                            <div className="col-span-1">Method</div>
                            <div className="col-span-1">Cheque #</div>
                            <div className="col-span-3">Error</div>
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
                                    <div className="col-span-3">
                                      <div className="relative">
                                        <input
                                          className="w-full rounded-xl border px-3 py-2 text-sm"
                                          value={r.member_match_query ?? ""}
                                          onFocus={() => {
                                            patchImportRowLocal(r.id, {
                                              member_match_open: true,
                                            });
                                          }}
                                          onBlur={() => {
                                            window.setTimeout(() => {
                                              patchImportRowLocal(r.id, {
                                                member_match_open: false,
                                              });
                                            }, 120);
                                          }}
                                          onChange={(e) => {
                                            const v = e.target.value;

                                            patchImportRowLocal(r.id, {
                                              member_match_query: v,
                                              member_match_open: true,
                                            });

                                            // auto-set member_id only on exact match
                                            const id =
                                              memberIdByLabel.get(
                                                v.trim().toLowerCase(),
                                              ) ?? null;
                                            patchImportRowLocal(r.id, {
                                              member_id: id,
                                            });
                                          }}
                                          placeholder="Type to match…"
                                        />

                                        {(r.member_match_open ?? false) ? (
                                          <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-auto">
                                            {(() => {
                                              const needle = (
                                                r.member_match_query ?? ""
                                              )
                                                .trim()
                                                .toLowerCase();

                                              const shown = !needle
                                                ? members.slice(0, 8)
                                                : members
                                                    .filter((m) =>
                                                      `${m.first_name} ${m.last_name}`
                                                        .toLowerCase()
                                                        .includes(needle),
                                                    )
                                                    .slice(0, 8);

                                              const exactId = needle
                                                ? (memberIdByLabel.get(
                                                    needle,
                                                  ) ?? null)
                                                : null;

                                              const showAddMemberRow =
                                                (
                                                  r.member_match_query ?? ""
                                                ).trim().length > 0 && !exactId;

                                              return (
                                                <>
                                                  {shown.length === 0 ? (
                                                    <div className="px-4 py-3 text-sm text-slate-600">
                                                      No matches.
                                                    </div>
                                                  ) : (
                                                    shown.map((m) => {
                                                      const label = `${m.first_name} ${m.last_name}`;
                                                      return (
                                                        <button
                                                          type="button"
                                                          key={m.id}
                                                          className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                                                          onMouseDown={(e) =>
                                                            e.preventDefault()
                                                          }
                                                          onClick={() => {
                                                            patchImportRowLocal(
                                                              r.id,
                                                              {
                                                                member_id: m.id,
                                                                member_match_query:
                                                                  label,
                                                                member_match_open: false,
                                                              },
                                                            );
                                                          }}
                                                        >
                                                          {label}
                                                        </button>
                                                      );
                                                    })
                                                  )}

                                                  {showAddMemberRow ? (
                                                    <div className="border-t">
                                                      <button
                                                        type="button"
                                                        className="block w-full px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                                                        onMouseDown={(e) =>
                                                          e.preventDefault()
                                                        }
                                                        onClick={() =>
                                                          openQuickAddMemberFromQuery(
                                                            r.member_match_query ??
                                                              "",
                                                            r.id,
                                                          )
                                                        }
                                                      >
                                                        + Add new member
                                                        {(
                                                          r.member_match_query ??
                                                          ""
                                                        ).trim()
                                                          ? `: “${(r.member_match_query ?? "").trim()}”`
                                                          : ""}
                                                      </button>
                                                    </div>
                                                  ) : null}
                                                </>
                                              );
                                            })()}
                                          </div>
                                        ) : null}

                                        {!r.member_id &&
                                        (r.member_match_query ?? "").trim()
                                          .length > 0 ? (
                                          <div className="mt-1 text-[11px] text-amber-700">
                                            Select a valid member from the list
                                            (or add a new one).
                                          </div>
                                        ) : null}
                                      </div>

                                      <div className="mt-2">
                                        <input
                                          className="w-full rounded-xl border px-3 py-2 text-sm"
                                          value={r.member_name}
                                          onChange={(e) =>
                                            patchImportRowLocal(r.id, {
                                              member_name: e.target.value,
                                            })
                                          }
                                          placeholder="Member name from CSV"
                                        />
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-500">
                                        Use the CSV text to pick the correct
                                        member above.
                                      </div>
                                    </div>

                                    {/* Category selector */}
                                    <div className="col-span-2">
                                      <select
                                        className="w-full rounded-xl border px-3 py-2 text-sm"
                                        value={r.income_category_id ?? ""}
                                        onChange={(e) =>
                                          patchImportRowLocal(r.id, {
                                            income_category_id:
                                              e.target.value || null,
                                          })
                                        }
                                      >
                                        <option value="">— Select —</option>
                                        {incomeCats.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </select>
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
                                              cents === null
                                                ? null
                                                : Math.abs(cents),
                                          });
                                        }}
                                        placeholder="0.00"
                                      />
                                    </div>

                                    {/* Method */}
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
                                    </div>

                                    {/* Cheque */}
                                    <div className="col-span-1">
                                      {r.payment_method === "cheque" ? (
                                        <input
                                          className="w-full rounded-xl border px-3 py-2 text-sm"
                                          value={r.cheque_number ?? ""}
                                          onChange={(e) =>
                                            patchImportRowLocal(r.id, {
                                              cheque_number:
                                                e.target.value || null,
                                            })
                                          }
                                          placeholder="Cheque #"
                                        />
                                      ) : (
                                        <div className="text-xs text-slate-500 px-1 py-2">
                                          —
                                        </div>
                                      )}
                                    </div>

                                    {/* Error */}
                                    <div className="col-span-3">
                                      {Array.isArray(r.errors) &&
                                      r.errors.length > 0 ? (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                          {r.errors.join("; ")}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-slate-500"></div>
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
                  disabled={importBusy || savingImport || appendingImport}
                  className={`rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 ${
                    importBusy || savingImport || appendingImport
                      ? "opacity-50 pointer-events-none"
                      : ""
                  }`}
                  onClick={async () => {
                    await closeImportModal();
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
