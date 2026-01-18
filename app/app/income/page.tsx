"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { useRef } from "react";
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

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: "active" | "archived";
};

type DraftBatch = {
  id: string;
  org_id: string;
  service_category_id: string;
  session_date: string; // date string
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
  // Accept: "90", "90.5", "90.50", "$90.50", "-$90.50", " -90 "
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

export default function IncomePage() {
  const orgId = getActiveOrgId();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const isFinance = role === "finance" || role === "admin" || role === "owner";
  const isAdmin = role === "admin" || role === "owner";

  const [quickIncomeCatOpen, setQuickIncomeCatOpen] = useState(false);
  const [qicName, setQicName] = useState("");
  const [qicSaving, setQicSaving] = useState(false);
  const [qicErr, setQicErr] = useState("");

  // reference data
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [incomeCats, setIncomeCats] = useState<CategoryRow[]>([]);
  const [serviceCats, setServiceCats] = useState<CategoryRow[]>([]);

  // batches
  const [batches, setBatches] = useState<DraftBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // items for selected batch
  const [items, setItems] = useState<DraftItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("");

  // create batch modal
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchServiceId, setBatchServiceId] = useState<string>("");
  const [batchDate, setBatchDate] = useState<string>("");

  // add/edit item modal
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

  // publish state
  const [publishing, setPublishing] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // adjustment modal (admin only, negative only)
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjMemberId, setAdjMemberId] = useState<string>("");
  const [adjIncomeCategoryId, setAdjIncomeCategoryId] = useState<string>("");
  const [adjPaymentMethod, setAdjPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [adjChequeNumber, setAdjChequeNumber] = useState<string>("");
  const [adjAmount, setAdjAmount] = useState<string>("");
  const [adjNote, setAdjNote] = useState<string>("");
  const [adjErr, setAdjErr] = useState("");
  const [postingAdj, setPostingAdj] = useState(false);

  const [quickMemberOpen, setQuickMemberOpen] = useState(false);
  const [qmFirst, setQmFirst] = useState("");
  const [qmLast, setQmLast] = useState("");
  const [qmGender, setQmGender] = useState<"male" | "female" | "">("");
  const [qmAgeGroup, setQmAgeGroup] = useState<
    "1-12" | "13-17" | "18-35" | "36+" | ""
  >("");
  const [qmSaving, setQmSaving] = useState(false);
  const [qmErr, setQmErr] = useState("");

  const [memberQuery, setMemberQuery] = useState(""); // what user types
  const [adjMemberQuery, setAdjMemberQuery] = useState(""); // for adjustment modal

  const clearedOnFocusRef = useRef(false);
  const clearedIncomeCatOnFocusRef = useRef(false);

  const [incomeCatQuery, setIncomeCatQuery] = useState("");
  const [incomeCatSuggestOpen, setIncomeCatSuggestOpen] = useState(false);

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

  function openQuickAddIncomeCategoryFromQuery(q: string) {
    setQicName(q.trim()); // prefill modal input
    setQicErr("");
    setQuickIncomeCatOpen(true);
  }

  async function saveQuickIncomeCategory() {
    if (!orgId) return;
    const name = qicName.trim();
    if (!name) {
      setQicErr("Category name is required.");
      return;
    }

    setQicSaving(true);
    setQicErr("");

    const { data: sessionRes } = await supabase.auth.getSession();
    const userId = sessionRes.session?.user?.id;
    if (!userId) {
      setQicErr("You must be signed in.");
      setQicSaving(false);
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
      .select("id,name")
      .single();

    if (error) {
      setQicErr(error.message);
      setQicSaving(false);
      return;
    }

    await loadAll();

    if (data?.id) {
      setIncomeCategoryId(data.id);
    }

    setQicSaving(false);
    setQuickIncomeCatOpen(false);
    showToast("Income category added");
    setIncomeCatQuery(data.name);
  }

  function openQuickAddMemberFromQuery(q: string) {
    const parts = q.trim().split(/\s+/).filter(Boolean);
    setQmFirst(parts[0] ?? "");
    setQmLast(parts.slice(1).join(" ") || "");
    setQmGender("");
    setQmAgeGroup("");
    setQmErr("");
    setQuickMemberOpen(true);
  }

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

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  const draftCount = useMemo(
    () => batches.filter((b) => b.status === "draft").length,
    [batches]
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

  const [memberSuggestOpen, setMemberSuggestOpen] = useState(false);

  const filteredMembers = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase();
    if (!needle) return members.slice(0, 8);
    return members
      .filter((m) =>
        `${m.first_name} ${m.last_name}`.toLowerCase().includes(needle)
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
    // show if not an exact match
    return !exactMemberMatchId;
  }, [memberQuery, exactMemberMatchId]);

  const incomeCatNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of incomeCats) map.set(c.id, c.name);
    return map;
  }, [incomeCats]);

  const loadAll = async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    const myRole = await getMyRoleForOrg(orgId);
    setRole(myRole);

    const [membersRes, catsRes, batchesRes] = await Promise.all([
      supabase
        .from("members")
        .select("id,first_name,last_name,status")
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
          "id,org_id,service_category_id,session_date,status,created_by,created_at,updated_at,posted_by,posted_at"
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

    // select a batch if none selected
    if (!selectedBatchId && bs.length > 0) setSelectedBatchId(bs[0].id);

    setLoading(false);
  };

  const loadItems = async (batchId: string) => {
    if (!orgId) return;
    const res = await supabase
      .from("income_draft_items")
      .select(
        "id,org_id,batch_id,member_id,income_category_id,payment_method,cheque_number,amount_cents,created_by,created_at,updated_at"
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

  const showToast = (t: string) => {
    setToastText(t);
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
  };

  // ====== Batch create/delete ======
  const openCreateBatch = () => {
    setErr("");
    setBatchServiceId(serviceCats[0]?.id ?? "");
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setBatchDate(`${yyyy}-${mm}-${dd}`);
    setBatchOpen(true);
  };

  const createBatch = async () => {
    if (!orgId) return;

    if (draftCount >= 10) {
      setErr("Max 10 draft batches reached. Publish or delete one.");
      setBatchOpen(false);
      return;
    }

    if (!batchServiceId) {
      setErr("Select a service category.");
      return;
    }

    const { error } = await supabase.from("income_draft_batches").insert({
      org_id: orgId,
      service_category_id: batchServiceId,
      session_date: batchDate || null,
      status: "draft",
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setBatchOpen(false);
    await loadAll();
    showToast("Draft batch created");
  };

  const deleteDraftBatch = async (batchId: string) => {
    if (!isFinance) {
      setErr("Only finance/admin can delete drafts.");
      return;
    }
    const b = batches.find((x) => x.id === batchId);
    if (!b || b.status !== "draft") {
      setErr("Only draft batches can be deleted.");
      return;
    }

    const ok = confirm(
      "Delete this draft batch? This will remove all its draft items."
    );
    if (!ok) return;

    const { error } = await supabase
      .from("income_draft_batches")
      .delete()
      .eq("id", batchId);
    if (error) {
      setErr(error.message);
      return;
    }

    if (selectedBatchId === batchId) setSelectedBatchId(null);

    await loadAll();
    showToast("Draft deleted");
  };

  // ====== Item add/edit/delete ======
  const resetItemForm = () => {
    const firstId = members[0]?.id ?? "";
    setMemberId(firstId);
    setMemberQuery(firstId ? memberLabelById.get(firstId) ?? "" : "");

    const firstCat = incomeCats[0]?.id ?? "";
    setIncomeCategoryId(firstCat);
    setIncomeCatQuery(firstCat ? incomeCatLabelById.get(firstCat) ?? "" : "");
    setPaymentMethod("cash");
    setChequeNumber("");
    setAmount("");
    setItemErr("");
    setEditItemId(null);
  };

  const openAddItem = () => {
    if (!selectedBatch || selectedBatch.status !== "draft") {
      setErr("Select a draft batch to add items.");
      return;
    }
    resetItemForm();
    setItemMode("create");
    setItemOpen(true);
  };

  function computeSegment(
    g: "male" | "female",
    ag: "1-12" | "13-17" | "18-35" | "36+"
  ) {
    const under18 = ag === "1-12" || ag === "13-17";
    if (under18) return g === "male" ? "boys" : "girls";
    return g === "male" ? "men" : "women";
  }

  async function saveQuickMember() {
    if (!orgId) return;
    setQmErr("");

    if (!qmFirst.trim() || !qmLast.trim() || !qmGender || !qmAgeGroup) {
      setQmErr("First name, last name, gender, and age group are required.");
      return;
    }

    const segment = computeSegment(qmGender, qmAgeGroup);
    setQmSaving(true);

    const { data, error } = await supabase
      .from("members")
      .insert({
        org_id: orgId,
        first_name: qmFirst.trim(),
        last_name: qmLast.trim(),
        gender: qmGender,
        age_group: qmAgeGroup,
        segment,
        status: "active",
      })
      .select("id,first_name,last_name")
      .single();

    if (error) {
      setQmErr(error.message);
      setQmSaving(false);
      return;
    }

    // refresh members and select new one
    await loadAll();

    const newId = data?.id as string | undefined;
    const label = `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim();

    if (newId) {
      setMemberId(newId);
      setMemberQuery(label);
    }

    setQmSaving(false);
    setQuickMemberOpen(false);
    showToast("Member added");
  }

  function isGender(v: string): v is "male" | "female" {
    return v === "male" || v === "female";
  }

  function isAgeGroup(v: string): v is "1-12" | "13-17" | "18-35" | "36+" {
    return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
  }

  const openEditItem = (it: DraftItem) => {
    if (!selectedBatch || selectedBatch.status !== "draft") return;
    setItemMode("edit");
    setEditItemId(it.id);
    setMemberId(it.member_id);
    setMemberQuery(memberLabelById.get(it.member_id) ?? "");

    setIncomeCategoryId(it.income_category_id);
    setIncomeCatQuery(incomeCatLabelById.get(it.income_category_id) ?? "");
    setPaymentMethod(it.payment_method);
    setChequeNumber(it.cheque_number ?? "");
    setAmount((it.amount_cents / 100).toFixed(2));
    setItemErr("");
    setItemOpen(true);
  };

  const saveItem = async () => {
    if (!orgId || !selectedBatchId) return;

    if (!memberId) {
      setItemErr("Member is required.");
      return;
    }
    if (!incomeCategoryId) {
      setItemErr("Income category is required.");
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
      const { error } = await supabase.from("income_draft_items").insert({
        org_id: orgId,
        batch_id: selectedBatchId,
        member_id: memberId,
        income_category_id: incomeCategoryId,
        payment_method: paymentMethod,
        cheque_number: paymentMethod === "cheque" ? chequeNumber.trim() : null,
        amount_cents: cents,
      });

      if (error) {
        setItemErr(error.message);
        setSavingItem(false);
        return;
      }

      setSavingItem(false);
      setAmount("");
      setItemErr("");
      setChequeNumber("");
      await loadAll();
      await loadItems(selectedBatchId);
      showToast("Draft item added");
    } else {
      if (!editItemId) {
        setSavingItem(false);
        return;
      }

      const { error } = await supabase
        .from("income_draft_items")
        .update({
          member_id: memberId,
          income_category_id: incomeCategoryId,
          payment_method: paymentMethod,
          cheque_number:
            paymentMethod === "cheque" ? chequeNumber.trim() : null,
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
      showToast("Draft item updated");
    }
  };

  const removeItem = async (id: string) => {
    if (!selectedBatch || selectedBatch.status !== "draft") return;
    const ok = confirm("Remove this draft item?");
    if (!ok) return;

    const { error } = await supabase
      .from("income_draft_items")
      .delete()
      .eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }

    await loadAll();
    await loadItems(selectedBatch.id);
    showToast("Removed");
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

    const { error } = await supabase.rpc("publish_income_draft", {
      p_batch_id: selectedBatch.id,
    });
    if (error) {
      setErr(error.message);
      setPublishing(false);
      return;
    }

    setPublishing(false);
    await loadAll();
    await loadItems(selectedBatch.id);
    showToast("Published");
  };

  // ====== Negative Adjustment (Admin only) ======
  const openAdjustment = () => {
    if (!selectedBatch || selectedBatch.status !== "published") {
      setErr("Adjustments require a published batch.");
      return;
    }
    if (!isAdmin) {
      setErr("Admin only.");
      return;
    }
    const firstId = members[0]?.id ?? "";
    setAdjMemberId(firstId);
    setAdjMemberQuery(firstId ? memberLabelById.get(firstId) ?? "" : "");
    setAdjIncomeCategoryId(incomeCats[0]?.id ?? "");
    setAdjPaymentMethod("cash");
    setAdjChequeNumber("");
    setAdjAmount("");
    setAdjNote("");
    setAdjErr("");
    setAdjOpen(true);
  };

  const postAdjustment = async () => {
    if (!selectedBatch) return;
    if (!isAdmin) {
      setAdjErr("Admin only.");
      return;
    }

    if (!adjMemberId) {
      setAdjErr("Member is required.");
      return;
    }
    if (!adjIncomeCategoryId) {
      setAdjErr("Income category is required.");
      return;
    }
    if (adjPaymentMethod === "cheque" && adjChequeNumber.trim().length === 0) {
      setAdjErr("Cheque number is required for cheque.");
      return;
    }

    const rawCents = parseMoneyToCents(adjAmount);
    if (rawCents === null || rawCents === 0) {
      setAdjErr("Amount must be greater than zero.");
      return;
    }

    const absCents = Math.abs(rawCents);

    setPostingAdj(true);
    setAdjErr("");

    const { error } = await supabase.rpc("add_income_negative_adjustment", {
      p_batch_id: selectedBatch.id,
      p_member_id: adjMemberId,
      p_income_category_id: adjIncomeCategoryId,
      p_payment_method: adjPaymentMethod,
      p_cheque_number:
        adjPaymentMethod === "cheque" ? adjChequeNumber.trim() : null,
      p_amount_cents: absCents, // RPC will force negative
      p_note: adjNote || null,
    });

    if (error) {
      setAdjErr(error.message);
      setPostingAdj(false);
      return;
    }

    setPostingAdj(false);
    setAdjOpen(false);
    showToast("Negative adjustment posted");
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
            <div className="text-xl font-semibold">Income</div>
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
              onClick={() => router.push("/app/income/published")}
            >
              View Published
            </button>
          </div>
        </div>

        {err ? (
          <div className="px-6 pb-5">
            <div className="rounded-2xl border bg-primary/10 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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

                      {/* Delete draft (finance/admin/owner only) */}
                      {isFinance && b.status === "draft" ? (
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
              <div className="rounded-2xl border bg-primary/15  p-4 text-sm text-slate-700">
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
                          className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                            !isFinance || publishing
                              ? "bg-slate-300"
                              : "bg-primary hover:bg-primary/85"
                          }`}
                          disabled={!isFinance || publishing}
                          onClick={publishBatch}
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
                      <>
                        <button
                          className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                            !isAdmin
                              ? "bg-slate-300"
                              : "bg-primary hover:bg-primary/85"
                          }`}
                          disabled={!isAdmin}
                          onClick={openAdjustment}
                          title={
                            !isAdmin
                              ? "Admin only"
                              : "Post a negative adjustment"
                          }
                        >
                          Negative adjustment (−)
                        </button>
                        <button
                          className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                          onClick={openCreateBatch}
                        >
                          New draft
                        </button>
                      </>
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
                        <div className="col-span-1">Category</div>
                        <div className="col-span-2 ">Amount</div>
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
                              className="grid grid-cols-12 items-center px-5 py-4 text-sm"
                            >
                              <div className="col-span-3 font-semibold">
                                {memberNameById.get(it.member_id) ?? "—"}
                              </div>
                              <div className="col-span-1 text-slate-700">
                                {incomeCatNameById.get(it.income_category_id) ??
                                  "—"}
                              </div>
                              <div className="col-span-2  font-semibold">
                                {formatMoney(it.amount_cents)}
                              </div>
                              <div className="col-span-1 text-slate-700">
                                {it.payment_method}
                              </div>
                              <div className="col-span-1 text-slate-700">
                                {it.payment_method === "cheque"
                                  ? it.cheque_number ?? "—"
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
                                      onClick={() => removeItem(it.id)}
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
                <div className="rounded-2xl border bg-primary/10 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Max 10 drafts reached. Publish or delete one to create a new
                  batch.
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-20 py-2 text-sm hover:bg-slate-50"
                onClick={() => setBatchOpen(false)}
              >
                Cancel
              </button>
              <button
                className={`rounded-2xl px-20 py-2 text-sm font-semibold text-white ${
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

      {/* Add/Edit item modal */}
      {itemOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          // onClick={() => setItemOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-3xl bg-white shadow-xl"
            // onClick={(e) => e.stopPropagation()}
          >
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
                {/* Member */}
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
                          120
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

                {/* Income category */}
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
                          120
                        );
                        clearedIncomeCatOnFocusRef.current = false;
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setIncomeCatQuery(v);
                        setItemErr("");

                        const id = incomeCatIdByLabel.get(
                          v.trim().toLowerCase()
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
                                  incomeCatQuery
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
                {/* <div className="mt-1 text-xs text-slate-500">Stored as integer cents internally.</div> */}
              </div>

              {itemErr ? (
                <div className="rounded-2xl border bg-primary/10 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {itemErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-35 py-2 text-sm hover:bg-slate-50"
                onClick={() => setItemOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-35 py-2 text-sm font-semibold text-white ${
                  savingItem ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={savingItem}
                onClick={saveItem}
              >
                {savingItem ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quickMemberOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
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
                onClick={() => setQuickMemberOpen(false)}
              >
                Cancel
              </button>
              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  qmSaving ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={qmSaving}
                onClick={saveQuickMember}
              >
                {qmSaving ? "Saving…" : "Save member"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                onClick={saveQuickIncomeCategory}
              >
                {qicSaving ? "Saving…" : "Save category"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Negative adjustment modal (admin only) */}
      {adjOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Negative adjustment</div>
              <div className="text-xs text-slate-600">
                Posts a correcting entry. Published entries can’t be edited.
                Admin only.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div className="rounded-2xl border bg-primary/10 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This will post a <span className="font-semibold">negative</span>{" "}
                amount to correct an earlier mistake. If you need to add missing
                income, create a new draft batch instead.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Member *
                  </div>
                  <div>
                    <input
                      list="members-datalist-adj"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      value={adjMemberQuery}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAdjMemberQuery(v);
                        setAdjErr("");

                        const id = memberIdByLabel.get(v.trim().toLowerCase());
                        if (id) setAdjMemberId(id);
                        else setAdjMemberId("");
                      }}
                      placeholder="Type a name…"
                    />

                    <datalist id="members-datalist-adj">
                      {members.map((m) => (
                        <option
                          key={m.id}
                          value={`${m.first_name} ${m.last_name}`}
                        />
                      ))}
                    </datalist>

                    {!adjMemberId && adjMemberQuery.trim().length > 0 ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Select a valid member from suggestions.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Income category *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={adjIncomeCategoryId}
                    onChange={(e) => {
                      setAdjIncomeCategoryId(e.target.value);
                      setAdjErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    {incomeCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Method *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
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
                    className={`w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 ${
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
                  Amount (will be negative) *
                </div>
                <div className="flex">
                  <div className="flex items-center rounded-l-2xl border border-r-0 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
                    −$
                  </div>
                  <input
                    className="w-full rounded-r-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    value={adjAmount}
                    onChange={(e) => {
                      setAdjAmount(e.target.value);
                      setAdjErr("");
                    }}
                    placeholder="e.g., 90.00"
                  />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  We take the absolute value and store it as a negative
                  correction (typing “-90” is okay).
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Reason / Note (optional)
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  placeholder="e.g., Corrected mis-typed amount"
                />
              </div>

              {adjErr ? (
                <div className="rounded-2xl border bg-primary/10 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                {postingAdj ? "Posting…" : "Post negative adjustment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
