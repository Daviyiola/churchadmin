"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

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

type PublishedBatch = {
  id: string;
  org_id: string;
  service_category_id: string;
  session_date: string;
  status: "published";
  created_by: string;
  created_at: string;
  updated_at: string;
  posted_by: string | null;
  posted_at: string | null;
};

type IncomeEntry = {
  id: string;
  org_id: string;
  batch_id: string;

  service_category_id: string;
  session_date: string;

  member_id: string;
  income_category_id: string;

  payment_method: PaymentMethod;
  cheque_number: string | null;

  amount_cents: number;
  entry_type: "normal" | "adjustment";
  note: string | null;

  posted_by: string;
  posted_at: string;
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

export default function IncomePublishedPage() {
  const orgId = getActiveOrgId();

  const [role, setRole] = useState<Role | null>(null);
  const isAdmin = role === "admin" || role === "owner";

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [incomeCats, setIncomeCats] = useState<CategoryRow[]>([]);
  const [serviceCats, setServiceCats] = useState<CategoryRow[]>([]);

  const [batches, setBatches] = useState<PublishedBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ===== Filters =====
  // Batch list filters
  const [serviceFilter, setServiceFilter] = useState<string>("all"); // service_category_id or "all"
  const [dateFrom, setDateFrom] = useState<string>(() => {
    // default last 30 days (nice usability)
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toISODateInput(d);
  });
  const [dateTo, setDateTo] = useState<string>(() => toISODateInput(new Date()));

  // Entry filters (within selected batch)
  const [memberQuery, setMemberQuery] = useState("");
  const [memberIdFilter, setMemberIdFilter] = useState<string>(""); // resolved id or ""
  const [incomeCatFilter, setIncomeCatFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");
  const [entryTypeFilter, setEntryTypeFilter] = useState<"all" | "normal" | "adjustment">("all");

  // Negative adjustment modal (admin only)
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjMemberQuery, setAdjMemberQuery] = useState("");
  const [adjMemberId, setAdjMemberId] = useState("");
  const [adjIncomeCategoryId, setAdjIncomeCategoryId] = useState("");
  const [adjPaymentMethod, setAdjPaymentMethod] = useState<PaymentMethod>("cash");
  const [adjChequeNumber, setAdjChequeNumber] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjErr, setAdjErr] = useState("");
  const [postingAdj, setPostingAdj] = useState(false);

  const memberLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, `${m.first_name} ${m.last_name}`);
    return map;
  }, [members]);

  const memberIdByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(`${m.first_name} ${m.last_name}`.toLowerCase(), m.id);
    return map;
  }, [members]);

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of serviceCats) map.set(c.id, c.name);
    return map;
  }, [serviceCats]);

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
        .select("id,org_id,service_category_id,session_date,status,created_by,created_at,updated_at,posted_by,posted_at")
        .eq("org_id", orgId)
        .eq("status", "published")
        .order("posted_at", { ascending: false }),
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

    const bs = (batchesRes.data ?? []) as PublishedBatch[];
    setBatches(bs);

    if (!selectedBatchId && bs.length > 0) setSelectedBatchId(bs[0].id);

    setLoading(false);
  };

  const loadEntries = async (batchId: string) => {
    if (!orgId) return;

    const res = await supabase
      .from("income_entries")
      .select(
        "id,org_id,batch_id,service_category_id,session_date,member_id,income_category_id,payment_method,cheque_number,amount_cents,entry_type,note,posted_by,posted_at"
      )
      .eq("org_id", orgId)
      .eq("batch_id", batchId)
      .order("posted_at", { ascending: true });

    if (res.error) {
      setErr(res.error.message);
      setEntries([]);
      return;
    }

    setEntries((res.data ?? []) as IncomeEntry[]);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (selectedBatchId) loadEntries(selectedBatchId);
    else setEntries([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  // ===== Apply filters =====

  const filteredBatches = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;

    return batches.filter((b) => {
      if (serviceFilter !== "all" && b.service_category_id !== serviceFilter) return false;

      if (from || to) {
        const d = new Date(b.session_date + "T12:00:00");
        if (from && d < from) return false;
        if (to && d > to) return false;
      }

      return true;
    });
  }, [batches, serviceFilter, dateFrom, dateTo]);

  // keep selection valid when batch filters change
  useEffect(() => {
    if (!selectedBatchId) return;
    const stillVisible = filteredBatches.some((b) => b.id === selectedBatchId);
    if (stillVisible) return;

    if (filteredBatches.length > 0) setSelectedBatchId(filteredBatches[0].id);
    else setSelectedBatchId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceFilter, dateFrom, dateTo, batches]);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (memberIdFilter && e.member_id !== memberIdFilter) return false;
      if (incomeCatFilter !== "all" && e.income_category_id !== incomeCatFilter) return false;
      if (methodFilter !== "all" && e.payment_method !== methodFilter) return false;
      if (entryTypeFilter !== "all" && e.entry_type !== entryTypeFilter) return false;
      return true;
    });
  }, [entries, memberIdFilter, incomeCatFilter, methodFilter, entryTypeFilter]);

  const filteredTotalCents = useMemo(
    () => filteredEntries.reduce((s, e) => s + e.amount_cents, 0),
    [filteredEntries]
  );

  const openAdjustment = () => {
    if (!selectedBatch) return;
    if (!isAdmin) {
      setErr("Admin only.");
      return;
    }
    const firstId = members[0]?.id ?? "";
    setAdjMemberId(firstId);
    setAdjMemberQuery(firstId ? (memberLabelById.get(firstId) ?? "") : "");
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
    if (!isAdmin) return;

    if (!adjMemberId) return setAdjErr("Member is required.");
    if (!adjIncomeCategoryId) return setAdjErr("Income category is required.");
    if (adjPaymentMethod === "cheque" && adjChequeNumber.trim().length === 0) {
      return setAdjErr("Cheque number is required for cheque.");
    }

    const raw = parseMoneyToCents(adjAmount);
    if (raw === null || raw === 0) return setAdjErr("Amount must be greater than zero.");

    const absCents = Math.abs(raw);

    setPostingAdj(true);
    setAdjErr("");

    const { error } = await supabase.rpc("add_income_negative_adjustment", {
      p_batch_id: selectedBatch.id,
      p_member_id: adjMemberId,
      p_income_category_id: adjIncomeCategoryId,
      p_payment_method: adjPaymentMethod,
      p_cheque_number: adjPaymentMethod === "cheque" ? adjChequeNumber.trim() : null,
      p_amount_cents: absCents,
      p_note: adjNote || null,
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
    setMemberQuery("");
    setMemberIdFilter("");
    setIncomeCatFilter("all");
    setMethodFilter("all");
    setEntryTypeFilter("all");
  };

  if (!orgId) return <div className="p-6 text-slate-700">No active organization selected.</div>;
  if (loading) return <div className="p-10 text-slate-700">Loading…</div>;

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Income • Published</div>
            <div className="text-sm text-slate-600">Immutable entries (includes adjustments)</div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/app/income" className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50">
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
                <div className="mt-1 text-xs text-slate-600">{filteredBatches.length} shown</div>
              </div>
              <Pill>v1</Pill>
            </div>

            {/* Batch filters */}
            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Service</div>
                <select
                  className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                >
                  <option value="all">All services</option>
                  {serviceCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">From</div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">To</div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {filteredBatches.length === 0 ? (
                <div className="rounded-2xl border bg-primary/15  p-4 text-sm text-slate-700">
                  No published batches match your filters.
                </div>
              ) : (
                filteredBatches.map((b) => {
                  const active = b.id === selectedBatchId;
                  const label = `${serviceNameById.get(b.service_category_id) ?? "Service"} — ${fmtDate(
                    b.session_date
                  )}`;

                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBatchId(b.id)}
                      className={`w-full  rounded-2xl px-4 py-3 text-left text-sm ${
                        active ? "bg-primary text-white" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{label}</div>
                          <div className={`mt-1 text-xs ${active ? "text-white/80" : "text-slate-600"}`}>
                            Posted {b.posted_at ? fmtDate(b.posted_at) : "—"}
                          </div>
                        </div>
                        <div className="shrink-0">
            
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
              <div className="rounded-2xl border bg-primary/15  p-4 text-sm text-slate-700">
                Select a published batch.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {serviceNameById.get(selectedBatch.service_category_id) ?? "Service"} —{" "}
                      {fmtDate(selectedBatch.session_date)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {filteredEntries.length} entries shown • Total {formatMoney(filteredTotalCents)}
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
                        !isAdmin ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={!isAdmin}
                      onClick={openAdjustment}
                      title={!isAdmin ? "Admin only" : "Post a negative adjustment"}
                    >
                      Negative adjustment (−)
                    </button>
                  </div>
                </div>

                {/* Entry filters */}
                <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">Member</div>
                      <input
                        list="members-filter-dl"
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={memberQuery}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMemberQuery(v);
                          const id = memberIdByLabel.get(v.trim().toLowerCase());
                          setMemberIdFilter(id ?? "");
                        }}
                        placeholder="Type a name…"
                      />
                      <datalist id="members-filter-dl">
                        {members.map((m) => (
                          <option key={m.id} value={`${m.first_name} ${m.last_name}`} />
                        ))}
                      </datalist>
                      {memberQuery.trim() && !memberIdFilter ? (
                        <div className="mt-1 text-xs text-amber-700">Pick a valid member from suggestions.</div>
                      ) : null}
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">Income category</div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={incomeCatFilter}
                        onChange={(e) => setIncomeCatFilter(e.target.value)}
                      >
                        <option value="all">All categories</option>
                        {incomeCats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">Method</div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={methodFilter}
                        onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | "all")}
                      >
                        <option value="all">All methods</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="online">Online</option>
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">Entry type</div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={entryTypeFilter}
                        onChange={(e) => setEntryTypeFilter(e.target.value as "all" | "normal" | "adjustment")}
                      >
                        <option value="all">All</option>
                        <option value="normal">Normal</option>
                        <option value="adjustment">Adjustment</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-[1100px]">
                      <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100 rounded-t-3xl">
                        <div className="col-span-3">Member</div>
                        <div className="col-span-2">Category</div>
                        <div className="col-span-2">Amount</div>
                        <div className="col-span-2">Entry</div>
                        <div className="col-span-2">Method</div>
                        <div className="col-span-1">Cheque #</div>                        
                      </div>

                      {filteredEntries.length === 0 ? (
                        <div className="p-6 text-sm text-slate-600">No entries match your filters.</div>
                      ) : (
                        <div className="divide-y">
                          {filteredEntries.map((e) => (
                            <div key={e.id} className="grid grid-cols-12 items-center px-5 py-4 text-sm">
                              <div className="col-span-3 font-semibold">
                                {memberLabelById.get(e.member_id) ?? "—"}
                              </div>
                              <div className="col-span-2 text-slate-700">
                                {incomeCatNameById.get(e.income_category_id) ?? "—"}
                              </div>
                              <div className="col-span-2 font-semibold">{formatMoney(e.amount_cents)}</div>
                              <div className="col-span-2">
                                <div className="text-slate-700">{e.entry_type}</div>
                                {e.note ? <div className="text-xs text-slate-500 truncate">{e.note}</div> : null}
                              </div>
                              <div className="col-span-2 text-slate-700">{e.payment_method}</div>
                              <div className="col-span-1 text-slate-700">
                                {e.payment_method === "cheque" ? e.cheque_number ?? "—" : "—"}
                              </div>
                              
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Negative adjustment modal */}
      {adjOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Negative adjustment</div>
              <div className="text-xs text-slate-600">Posts a correcting entry. Admin only.</div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This will post a <span className="font-semibold">negative</span> amount to correct an earlier mistake.
                If you need to add missing income, create a new draft batch instead.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Member *</div>
                  <input
                    list="members-dl-pub-adj"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={adjMemberQuery}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAdjMemberQuery(v);
                      setAdjErr("");
                      const id = memberIdByLabel.get(v.trim().toLowerCase());
                      setAdjMemberId(id ?? "");
                    }}
                    placeholder="Type a name…"
                  />
                  <datalist id="members-dl-pub-adj">
                    {members.map((m) => (
                      <option key={m.id} value={`${m.first_name} ${m.last_name}`} />
                    ))}
                  </datalist>
                  {!adjMemberId && adjMemberQuery.trim() ? (
                    <div className="mt-1 text-xs text-amber-700">Select a valid member from suggestions.</div>
                  ) : null}
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Income category *</div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
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
                  <div className="mb-1 text-xs font-semibold text-slate-600">Method *</div>
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
                      adjPaymentMethod !== "cheque" ? "bg-slate-50 text-slate-500" : ""
                    }`}
                    value={adjChequeNumber}
                    onChange={(e) => {
                      setAdjChequeNumber(e.target.value);
                      setAdjErr("");
                    }}
                    disabled={adjPaymentMethod !== "cheque"}
                    placeholder={adjPaymentMethod === "cheque" ? "e.g., 103849" : "—"}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Amount (will be negative) *</div>
                <div className="flex">
                  <div className="flex items-center rounded-l-2xl border border-r-0 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
                    −$
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
                {/* <div className="mt-1 text-xs text-slate-500">We take absolute value and store it as negative.</div> */}
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Reason / Note (optional)</div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  placeholder="e.g., Corrected mis-typed amount"
                />
              </div>

              {adjErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {adjErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={() => setAdjOpen(false)}>
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
