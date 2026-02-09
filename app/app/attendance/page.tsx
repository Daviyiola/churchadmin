"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { useRouter } from "next/navigation";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";
type CategoryType = "income" | "expense" | "services";

// === Your member shape (based on what you shared) ===
type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: "active" | "archived";
  membership_stage: "member" 
  gender: "male" | "female";
  dob: string | null;
  age_group: "1-12" | "13-17" | "18-35" | "36+" | "unknown";
  segment: "men" | "women" | "boys" | "girls" | "unknown";
  note: string | null;
};


// === Attendance draft batch ===
type DraftBatch = {
  id: string;
  org_id: string;
  service_category_id: string;
  session_date: string; // YYYY-MM-DD
  status: "draft" | "published";
  created_by: string;
  created_at: string;
  updated_at: string;
  published_by: string | null;
  published_at: string | null;
};

// === Draft member roll rows ===
type DraftMember = {
  id: string;
  org_id: string;
  session_id: string;
  member_id: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

// === Draft headcount rows ===
// IMPORTANT: rename fields if your schema differs
type DraftHeadcount = {
  id: string;
  org_id: string;
  session_id: string;
  age_group: "1-12" | "13-17" | "18-35" | "36+" | "unknown";
  gender: "male" | "female";
  segment: "men" | "women" | "boys" | "girls" | "unknown";
  count: number;
  created_by: string;
  created_at: string;
};

type CategoryRow = {
  id: string;
  name: string;
  type: CategoryType;
  status: "active" | "archived";
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

function toISODateInput(d: Date) {
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

function isGender(v: string): v is "male" | "female" {
  return v === "male" || v === "female";
}

function isAgeGroup(v: string): v is "1-12" | "13-17" | "18-35" | "36+" {
  return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
}

function computeSegment(
  g: "male" | "female",
  ag: "1-12" | "13-17" | "18-35" | "36+",
) {
  const under18 = ag === "1-12" || ag === "13-17";
  if (under18) return g === "male" ? "boys" : "girls";
  return g === "male" ? "men" : "women";
}

function computeAgeFromDobOnDate(dobStr: string, onDate: Date) {
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > onDate.getTime()) return null;

  let age = onDate.getFullYear() - d.getFullYear();
  const m = onDate.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && onDate.getDate() < d.getDate())) age--;
  return age;
}

function ageGroupForAge(age: number): "1-12" | "13-17" | "18-35" | "36+" {
  if (age <= 12) return "1-12";
  if (age <= 17) return "13-17";
  if (age <= 35) return "18-35";
  return "36+";
}

function sessionAgeGroup(
  m: MemberRow,
  sessionDate: string,
): MemberRow["age_group"] {
  // If DOB exists, compute for that session date
  if (m.dob) {
    const on = new Date(`${sessionDate}T00:00:00`);
    const age = computeAgeFromDobOnDate(m.dob, on);
    if (age !== null) return ageGroupForAge(age);
  }
  // fallback to stored
  return m.age_group ?? "unknown";
}

export default function AttendanceDraftPage() {
  const orgId = getActiveOrgId();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const isFinance = role === "finance" || role === "admin" || role === "owner";
  const isAdmin = role === "admin" || role === "owner";

  // quick add member
  const [quickMemberOpen, setQuickMemberOpen] = useState(false);
  const [qmFirst, setQmFirst] = useState("");
  const [qmLast, setQmLast] = useState("");
  const [qmGender, setQmGender] = useState<"male" | "female" | "">("");
  const [qmAgeGroup, setQmAgeGroup] = useState<
    "1-12" | "13-17" | "18-35" | "36+" | ""
  >("");
  const [qmSaving, setQmSaving] = useState(false);
  const [qmErr, setQmErr] = useState("");

  // reference data
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [serviceCats, setServiceCats] = useState<CategoryRow[]>([]);

  // batches
  const [batches, setBatches] = useState<DraftBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  // draft content
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>([]);
  const [draftHeadcounts, setDraftHeadcounts] = useState<DraftHeadcount[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("");

  // create batch modal
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchServiceId, setBatchServiceId] = useState<string>("");
  const [batchDate, setBatchDate] = useState<string>("");

  // ---- NEW: Two-list UI state ----
  const [activeQuery, setActiveQuery] = useState("");
  const [rollNote, setRollNote] = useState(""); // optional note for next clicks

  // headcount quick entry (simple MVP)
  const [hcAgeGroup, setHcAgeGroup] =
    useState<DraftHeadcount["age_group"]>("1-12");
  const [hcGender, setHcGender] = useState<DraftHeadcount["gender"]>("male");
  const [hcCount, setHcCount] = useState<string>("");
  const [hcErr, setHcErr] = useState("");

  // publish
  const [publishing, setPublishing] = useState(false);

  const draftCount = useMemo(
    () => batches.filter((b) => b.status === "draft").length,
    [batches],
  );

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of serviceCats) map.set(c.id, c.name);
    return map;
  }, [serviceCats]);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberRow>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const attendedMemberIdSet = useMemo(() => {
    return new Set(draftMembers.map((x) => x.member_id));
  }, [draftMembers]);

  const activeMembersFiltered = useMemo(() => {
    const q = activeQuery.trim().toLowerCase();
    const list = members.filter((m) => !attendedMemberIdSet.has(m.id));
    if (!q) return list;
    return list.filter((m) =>
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q),
    );
  }, [members, activeQuery, attendedMemberIdSet]);

  const attendedMembers = useMemo(() => {
    // keep attended in the order draftMembers were created
    return draftMembers
      .map((x) => ({
        draftId: x.id,
        member: memberById.get(x.member_id),
        note: x.note ?? "",
        created_at: x.created_at,
      }))
      .filter(
        (
          x,
        ): x is {
          draftId: string;
          member: MemberRow;
          note: string;
          created_at: string;
        } => !!x.member,
      );
  }, [draftMembers, memberById]);

  const rollCount = draftMembers.length;

  const headcountTotal = useMemo(() => {
    return draftHeadcounts.reduce((s, r) => s + (r.count ?? 0), 0);
  }, [draftHeadcounts]);

  const summaryByGroup = useMemo(() => {
    const key = (ag: MemberRow["age_group"], g: MemberRow["gender"]) =>
      `${ag}|${g}`;
    const map = new Map<string, number>();

    const sessionDate = selectedBatch?.session_date; // YYYY-MM-DD or undefined

    const rows = draftMembers
      .map((dm) => memberById.get(dm.member_id))
      .filter((m): m is MemberRow => !!m);

    for (const m of rows) {
      const ag = sessionDate ? sessionAgeGroup(m, sessionDate) : m.age_group;
      const k = key(ag, m.gender);
      map.set(k, (map.get(k) ?? 0) + 1);
    }

    return map;
  }, [draftMembers, memberById, selectedBatch?.session_date]);

  const finalCount = rollCount + headcountTotal;

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

    const [membersRes, catsRes, batchesRes] = await Promise.all([
      supabase
        .from("members")
        .select(
          "id,first_name,last_name,status,gender,dob,age_group,segment",
        )
        .eq("org_id", orgId)
        .eq("status", "active")
        .eq("membership_stage", "member")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true }),
      supabase
        .from("categories")
        .select("id,name,type,status")
        .eq("org_id", orgId)
        .eq("status", "active")
        .in("type", ["services"])
        .order("name", { ascending: true }),
      supabase
        // IMPORTANT: table name assumption
        .from("attendance_sessions")
        .select(
          "id,org_id,service_category_id,session_date,status,created_by,created_at,updated_at,published_by,published_at,deleted_at,deleted_by",
        )
        .eq("org_id", orgId)
        .eq("status", "draft")
        .is("deleted_at", null)
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

    setMembers((membersRes.data ?? []) as MemberRow[]);
    setServiceCats((catsRes.data ?? []) as CategoryRow[]);
    const bs = (batchesRes.data ?? []) as DraftBatch[];
    setBatches(bs);

    if (!selectedBatchId && bs.length > 0) setSelectedBatchId(bs[0].id);

    setLoading(false);
  };

  const loadDraftContent = async (batchId: string) => {
    if (!orgId) return;

    const [mRes, hRes] = await Promise.all([
      supabase
        // IMPORTANT: table name assumption
        .from("attendance_draft_members")
        .select("id,org_id,session_id,member_id,note,created_by,created_at")
        .eq("org_id", orgId)
        .eq("session_id", batchId)
        .order("created_at", { ascending: true }),
      supabase
        // IMPORTANT: table name assumption
        .from("attendance_draft_headcounts")
        .select(
          "id,org_id,session_id,age_group,gender,count,created_by,created_at",
        )
        .eq("org_id", orgId)
        .eq("session_id", batchId)
        .order("created_at", { ascending: true }),
    ]);

    if (mRes.error) {
      setErr(mRes.error.message);
      setDraftMembers([]);
      return;
    }
    if (hRes.error) {
      setErr(hRes.error.message);
      setDraftHeadcounts([]);
      return;
    }

    setDraftMembers((mRes.data ?? []) as DraftMember[]);
    setDraftHeadcounts((hRes.data ?? []) as DraftHeadcount[]);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (selectedBatchId) loadDraftContent(selectedBatchId);
    else {
      setDraftMembers([]);
      setDraftHeadcounts([]);
    }
    setActiveQuery("");
    setRollNote("");
    setHcCount("");
    setHcErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  // ===== Batch create/delete =====
  const openCreateBatch = () => {
    setErr("");
    setBatchServiceId(serviceCats[0]?.id ?? "");
    setBatchDate(toISODateInput(new Date()));
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

    const { error } = await supabase.from("attendance_sessions").insert({
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
    showToast("Attendance draft created ✓");
  };

  const deleteDraftBatch = async (batchId: string) => {
    // you said: anyone can delete drafts (attendance low-stakes)
    const ok = confirm(
      "Delete this attendance draft? This will remove its roll/headcount.",
    );
    if (!ok) return;

    const { error } = await supabase
      .from("attendance_sessions")
      .delete()
      .eq("id", batchId);
    if (error) {
      setErr(error.message);
      return;
    }

    if (selectedBatchId === batchId) setSelectedBatchId(null);
    await loadAll();
    showToast("Draft deleted ✓");
  };

  // ===== Member roll actions (Two-list UI) =====
  const addDraftMember = async (memberId: string) => {
    if (!orgId || !selectedBatchId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    // if (draftHeadcounts.length > 0) {
    //   setErr(
    //     "Clear headcount before using individual roll (prevents double counting).",
    //   );
    //   return;
    // }

    // prevent duplicates client-side too
    if (attendedMemberIdSet.has(memberId)) return;

    const { error } = await supabase.from("attendance_draft_members").insert({
      org_id: orgId,
      session_id: selectedBatchId,
      member_id: memberId,
      note: rollNote.trim() ? rollNote.trim() : null,
    });

    if (error) {
      setErr(error.message);
      return;
    }

    await loadDraftContent(selectedBatchId);
  };

  const removeDraftMember = async (draftMemberId: string) => {
    if (!orgId || !selectedBatchId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    const { error } = await supabase
      .from("attendance_draft_members")
      .delete()
      .eq("id", draftMemberId);
    if (error) {
      setErr(error.message);
      return;
    }

    await loadDraftContent(selectedBatchId);
  };

  // ===== Headcount actions (MVP) =====
  const addHeadcount = async () => {
    if (!orgId || !selectedBatchId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    // if (draftMembers.length > 0) {
    //   setHcErr(
    //     "Clear individual roll before using headcount (prevents double counting).",
    //   );
    //   return;
    // }

    const n = Number(hcCount);
    if (!Number.isFinite(n) || n <= 0) {
      setHcErr("Count must be a positive number.");
      return;
    }

    setHcErr("");

    const segment =
      hcAgeGroup === "unknown"
        ? "unknown"
        : hcGender === "male"
          ? hcAgeGroup === "1-12" || hcAgeGroup === "13-17"
            ? "boys"
            : "men"
          : hcAgeGroup === "1-12" || hcAgeGroup === "13-17"
            ? "girls"
            : "women";

    const { error } = await supabase
      .from("attendance_draft_headcounts")
      .insert({
        org_id: orgId,
        session_id: selectedBatchId,
        age_group: hcAgeGroup,
        gender: hcGender,
        segment,
        count: Math.floor(n),
      });

    if (error) {
      setHcErr(error.message);
      return;
    }

    setHcCount("");
    await loadDraftContent(selectedBatchId);
  };

  async function saveQuickMember() {
    if (!orgId) return;

    if (!qmFirst.trim() || !qmLast.trim() || !qmGender || !qmAgeGroup) {
      setQmErr("First name, last name, gender, and age group are required.");
      return;
    }

    const segment = computeSegment(qmGender, qmAgeGroup);
    setQmSaving(true);
    setQmErr("");

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
      .select("id")
      .single();

    if (error) {
      setQmErr(error.message);
      setQmSaving(false);
      return;
    }

    await loadAll(); // refresh members list

    setQmSaving(false);
    setQuickMemberOpen(false);
    showToast("Member added");
  }

  const removeHeadcount = async (id: string) => {
    if (!orgId || !selectedBatchId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;

    const { error } = await supabase
      .from("attendance_draft_headcounts")
      .delete()
      .eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }

    await loadDraftContent(selectedBatchId);
  };

  const clearHeadcount = async () => {
    if (!orgId || !selectedBatchId) return;
    if (!selectedBatch || selectedBatch.status !== "draft") return;
    if (draftHeadcounts.length === 0) return;

    const ok = confirm("Clear all headcount rows for this draft?");
    if (!ok) return;

    const { error } = await supabase
      .from("attendance_draft_headcounts")
      .delete()
      .eq("org_id", orgId)
      .eq("session_id", selectedBatchId);

    if (error) {
      setErr(error.message);
      return;
    }

    await loadDraftContent(selectedBatchId);
    showToast("Cleared headcount");
  };

  // ===== Publish (RPC recommended) =====
  const publishBatch = async () => {
    if (!selectedBatch) return;

    // you said: anyone can publish attendance (low stakes)
    // If you still want to require finance/admin, switch to: if (!isFinance) { ... }
    if (selectedBatch.status !== "draft") return;

    if (draftMembers.length === 0 && draftHeadcounts.length === 0) {
      setErr("Mark attendance or add headcount before publishing.");
      return;
    }

    const ok = confirm("Publish this attendance draft?");
    if (!ok) return;

    setPublishing(true);
    setErr("");

    // IMPORTANT:
    // This assumes you created an RPC named publish_attendance_draft(p_batch_id uuid)
    // If you haven't, create it similar to publish_income_draft.
    const { error } = await supabase.rpc("publish_attendance_session", {
      p_session_id: selectedBatchId,
    });

    if (error) {
      setErr(error.message);
      setPublishing(false);
      return;
    }

    setPublishing(false);
    await loadAll();
    showToast("Published");
  };

  if (!orgId)
    return (
      <div className="p-6 text-slate-700">No active organization selected.</div>
    );
  if (loading) return <div className="p-10 text-slate-700">Loading…</div>;

  return (
    <>
      <Toast show={toastOpen} text={toastText} />

      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Attendance</div>
            <div className="text-sm text-slate-600">Draft and Publish</div>
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
                  : "Create a new attendance draft"
              }
            >
              New draft
            </button>

            <button
              className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
              onClick={() => router.push("/app/attendance/published")}
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
                <div className="text-sm font-semibold">Drafts</div>
                <div className="mt-1 text-xs text-slate-600">
                  {draftCount} / 10 drafts
                </div>
              </div>
              {/* <Pill>v1</Pill> */}
            </div>

            <div className="mt-4 space-y-2">
              {batches.length === 0 ? (
                <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                  No attendance drafts yet.
                </div>
              ) : (
                batches.map((b) => {
                  const active = b.id === selectedBatchId;
                  const label = `${serviceNameById.get(b.service_category_id) ?? "Service"} — ${fmtDate(
                    b.session_date,
                  )}`;

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
                              className={`font-medium truncate ${active ? "text-white" : ""}`}
                            >
                              Updated {fmtDate(b.updated_at)}
                            </div>
                          </div>
                          <div className="shrink-0">
                            <Pill>Draft</Pill>
                          </div>
                        </div>
                      </button>

                      <div className="border-t px-4 py-2">
                        <button
                          className="w-full rounded-xl border px-3 py-2 text-xs hover:bg-slate-50"
                          onClick={() => deleteDraftBatch(b.id)}
                        >
                          Delete draft
                        </button>
                      </div>
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
                Select a draft to edit.
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
                      Roll: {rollCount} • Headcount: {headcountTotal} • Final
                      count: <span className="font-semibold">{finalCount}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                        publishing
                          ? "bg-slate-300"
                          : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={publishing}
                      onClick={publishBatch}
                    >
                      {publishing ? "Publishing…" : "Publish"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-semibold">Counting rule</div>
                  <div className="mt-1 text-sm">
                    Use <span className="font-semibold">individual roll</span>{" "}
                    when you know identities. Use{" "}
                    <span className="font-semibold">headcount</span> only for
                    unknown visitors. Headcount should not include people already marked on roll.
                  </div>
                </div>

                {/* Default UI: Individual roll (two-list click-to-move) */}
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Individual roll</div>
                    <div className="text-xs text-slate-500">
                      Click a member once to mark attended.
                    </div>
                  </div>

                  <div className="mt-2 rounded-2xl border bg-white p-4">
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="lg:col-span-3">
                        <div className="text-xs font-semibold text-slate-600 mb-1">
                          Search active members
                        </div>
                        <input
                          className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"
                          placeholder="Search…"
                          value={activeQuery}
                          onChange={(e) => setActiveQuery(e.target.value)}
                          // disabled={draftHeadcounts.length > 0}
                        />
                       
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {/* Active list */}
                      <div className="rounded-2xl border bg-white">
                        <div className="border-b px-4 py-3">
                          <div className="text-sm font-semibold">
                            Active members
                          </div>
                          <div className="text-xs text-slate-600">
                            {activeMembersFiltered.length} available
                          </div>
                        </div>

                        <div className="max-h-[260px] overflow-auto p-2">
                          <div className="space-y-1">
                            {/* ALWAYS FIRST: Add new member (even when searching / no results) */}
                            <button
                              type="button"
                              className="w-full rounded-xl border border-dashed px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                              onClick={() => {
                                // optional: prefill first/last from search text if you want
                                setQuickMemberOpen(true);
                              }}
                              // disabled={draftHeadcounts.length > 0}
                             title= "Add a new member" 
                              //  {
                              //   draftHeadcounts.length > 0
                              //     ? "Clear headcount to use individual roll"
                              //     : "Add a new member"
                              // }
                            >
                              + Add new member
                              {activeQuery.trim()
                                ? `: “${activeQuery.trim()}”`
                                : ""}
                            </button>

                            {/* Then show results OR the empty-state message */}
                            {activeMembersFiltered.length === 0 ? (
                              <div className="p-3 text-sm text-slate-600">
                                No members found.
                              </div>
                            ) : (
                              activeMembersFiltered.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  className="w-full rounded-xl border px-3 py-2 text-left text-sm hover:bg-slate-50"
                                  // disabled={draftHeadcounts.length > 0}
                                  onClick={() => addDraftMember(m.id)}
                                  title="Click to mark attended"
                                >
                                  <div className="font-semibold">
                                    {m.first_name} {m.last_name}
                                  </div>
                                  <div className="text-xs text-slate-600">
                                    {m.gender} • {m.age_group} • {m.segment}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Attended list */}
                      <div className="rounded-2xl border bg-white">
                        <div className="border-b px-4 py-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold">
                              Attended
                            </div>
                            <div className="text-xs text-slate-600">
                              {attendedMembers.length} marked
                            </div>
                          </div>
                          <Pill>Roll</Pill>
                        </div>

                        <div className="max-h-[260px] overflow-auto p-2">
                          {attendedMembers.length === 0 ? (
                            <div className="p-3 text-sm text-slate-600">
                              No one marked yet.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {attendedMembers.map(
                                ({ draftId, member, note }) => (
                                  <button
                                    key={draftId}
                                    className="w-full rounded-xl border px-3 py-2 text-left text-sm hover:bg-slate-50"
                                    onClick={() => removeDraftMember(draftId)}
                                    title="Click to unmark"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="font-semibold">
                                          {member.first_name} {member.last_name}
                                        </div>
                                        <div className="text-xs text-slate-600">
                                          {(() => {
                                            const ag = selectedBatch
                                              ? sessionAgeGroup(
                                                  member,
                                                  selectedBatch.session_date,
                                                )
                                              : member.age_group;

                                            const seg =
                                              ag === "unknown"
                                                ? "unknown"
                                                : computeSegment(
                                                    member.gender,
                                                    ag,
                                                  );

                                            return `${member.gender} • ${ag} • ${seg}`;
                                          })()}
                                        </div>

                                        {note ? (
                                          <div className="text-xs text-slate-500 mt-1 truncate">
                                            {note}
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="text-xs text-slate-500">
                                        Unmark
                                      </div>
                                    </div>
                                  </button>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Summary (computed from roll) */}
                <div className="mt-4 rounded-2xl border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      Computed summary (from roll)
                    </div>
                    <Pill>Auto</Pill>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-[520px] w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-600">
                          <th className="text-left py-2">Age group</th>
                          <th className="text-right py-2">Male</th>
                          <th className="text-right py-2">Female</th>
                          <th className="text-right py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(["1-12", "13-17", "18-35", "36+"] as const).map(
                          (ag) => {
                            const male = summaryByGroup.get(`${ag}|male`) ?? 0;
                            const female =
                              summaryByGroup.get(`${ag}|female`) ?? 0;
                            return (
                              <tr key={ag}>
                                <td className="py-2 font-semibold">{ag}</td>
                                <td className="py-2 text-right">{male}</td>
                                <td className="py-2 text-right">{female}</td>
                                <td className="py-2 text-right font-semibold">
                                  {male + female}
                                </td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Headcount (optional) */}
                <div className="mt-4 rounded-2xl border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">
                        Headcount (visitors / unknown)
                      </div>
                      <div className="text-xs text-slate-600">
                        Use if identities are unknown.
                      </div>
                    </div>
                    <button
                      className="rounded-xl border px-3 py-2 text-xs hover:bg-slate-50"
                      onClick={clearHeadcount}
                      disabled={draftHeadcounts.length === 0}
                    >
                      Clear headcount
                    </button>
                  </div>

                  {/* {draftMembers.length > 0 ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Clear the individual roll to use headcount (prevents
                      double counting).
                    </div>
                  ) : null} */}

                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Age group
                      </div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"
                        value={hcAgeGroup}
                        onChange={(e) =>
                          setHcAgeGroup(
                            e.target.value as DraftHeadcount["age_group"],
                          )
                        }
                        // disabled={draftMembers.length > 0}
                      >
                        <option value="1-12">1-12</option>
                        <option value="13-17">13-17</option>
                        <option value="18-35">18-35</option>
                        <option value="36+">36+</option>
                        {/* <option value="unknown">Unknown</option> */}
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Gender
                      </div>
                      <select
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"
                        value={hcGender}
                        onChange={(e) =>
                          setHcGender(
                            e.target.value as DraftHeadcount["gender"],
                          )
                        }
                        // disabled={draftMembers.length > 0}
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Count
                      </div>
                      <input
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"
                        value={hcCount}
                        onChange={(e) => {
                          setHcCount(e.target.value);
                          setHcErr("");
                        }}
                        placeholder="e.g., 12"
                        // disabled={draftMembers.length > 0}
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        className="w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white bg-primary hover:bg-primary/85"
                        onClick={addHeadcount}
                        // disabled={draftMembers.length > 0}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {hcErr ? (
                    <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {hcErr}
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-2xl border bg-slate-50">
                    <div className="grid grid-cols-12 border-b px-4 py-2 text-xs font-semibold text-slate-600">
                      <div className="col-span-4">Age group</div>
                      <div className="col-span-3">Gender</div>
                      <div className="col-span-3 text-right">Count</div>
                      <div className="col-span-2 text-right">Action</div>
                    </div>

                    {draftHeadcounts.length === 0 ? (
                      <div className="p-4 text-sm text-slate-600">
                        No headcount rows yet.
                      </div>
                    ) : (
                      <div className="divide-y">
                        {draftHeadcounts.map((r) => (
                          <div
                            key={r.id}
                            className="grid grid-cols-12 items-center px-4 py-3 text-sm"
                          >
                            <div className="col-span-4 font-semibold">
                              {r.age_group}
                            </div>
                            <div className="col-span-3 text-slate-700">
                              {r.gender}
                            </div>
                            <div className="col-span-3 text-right font-semibold">
                              {r.count}
                            </div>
                            <div className="col-span-2 flex justify-end">
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                onClick={() => removeHeadcount(r.id)}
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Add New Member modal */}
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
                Quick add without leaving attendance.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    First name *
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm"
                    value={qmFirst}
                    onChange={(e) => setQmFirst(e.target.value)}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Last name *
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm"
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
                    className="w-full rounded-2xl border px-4 py-2 text-sm"
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
                    className="w-full rounded-2xl border px-4 py-2 text-sm"
                    value={qmAgeGroup}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || isAgeGroup(v)) setQmAgeGroup(v);
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="1-12">1–12</option>
                    <option value="13-17">13–17</option>
                    <option value="18-35">18–35</option>
                    <option value="36+">36+</option>
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

      {/* Create batch modal */}
      {batchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">New attendance draft</div>
              <div className="text-xs text-slate-600">Pick service + date.</div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Service *
                </div>
                <select
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"
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
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                />
              </div>

              {draftCount >= 10 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Max 10 drafts reached. Publish or delete one to create
                  another.
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
    </>
  );
}
