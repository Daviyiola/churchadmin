"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import FloatingXScroll from "@/components/FloatingXScroll";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";
type CategoryType = "income" | "expense" | "services";

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

type PublishedSession = {
  id: string;
  org_id: string;
  service_category_id: string;
  session_date: string;
  status: "published";
  created_at: string;
  updated_at: string;
  published_by: string | null;
  published_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;

  revision: number;
  last_edited_at: string | null;
  last_edited_by: string | null;
  last_edited_by_email: string | null;
};

type SessionEdit = {
  id: string;
  revision: number;
  old_service_category_id: string;
  new_service_category_id: string;
  old_service_name: string;
  new_service_name: string;
  old_session_date: string;
  new_session_date: string;
  edited_by_email: string | null;
  edited_at: string;
  reason: string;
};

type AttendanceEntry = {
  id: string;
  org_id: string;
  session_id: string;
  service_category_id: string;
  session_date: string;

  entry_source: "member" | "headcount";
  member_id: string | null;

  gender: "male" | "female";
  age_group: "1-12" | "13-17" | "18-35" | "36+";
  segment: "men" | "women" | "boys" | "girls";
  count: number;

  note: string | null;
  published_by: string;
  published_at: string;
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

export default function AttendancePublishedPage() {
  const orgId = getActiveOrgId();

  const [role, setRole] = useState<Role | null>(null);
  const isAdmin = role === "admin" || role === "owner";
  const canEditSession =
    role === "finance" || role === "admin" || role === "owner";

  const [serviceCats, setServiceCats] = useState<CategoryRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);

  const [sessions, setSessions] = useState<PublishedSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const [entries, setEntries] = useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [busy, setBusy] = useState<null | "revert" | "delete">(null);

  const [sessionEditOpen, setSessionEditOpen] = useState(false);
  const [sessionEditServiceId, setSessionEditServiceId] = useState("");
  const [sessionEditDate, setSessionEditDate] = useState("");
  const [sessionEditReason, setSessionEditReason] = useState("");
  const [sessionEditErr, setSessionEditErr] = useState("");
  const [savingSessionEdit, setSavingSessionEdit] = useState(false);
  const [sessionEditHistory, setSessionEditHistory] = useState<SessionEdit[]>(
    [],
  );
  const [loadingSessionHistory, setLoadingSessionHistory] = useState(false);

  function fmtDateTime(iso: string | null | undefined) {
    if (!iso) return "—";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString();
  }

  // Filters (session list)
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return toISODateInput(d);
  });
  const [dateTo, setDateTo] = useState<string>(() =>
    toISODateInput(new Date()),
  );
  const [showDeleted, setShowDeleted] = useState(false);

  const serviceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of serviceCats) m.set(c.id, c.name);
    return m;
  }, [serviceCats]);

  const memberLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of members) m.set(p.id, `${p.first_name} ${p.last_name}`);
    return m;
  }, [members]);

  const loadAll = async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    const myRole = await getMyRoleForOrg(orgId);
    setRole(myRole);

    const [catsRes, membersRes, sessionsRes] = await Promise.all([
      supabase
        .from("categories")
        .select("id,name,type,status")
        .eq("org_id", orgId)
        .eq("status", "active")
        .eq("type", "services")
        .order("name", { ascending: true }),
      supabase
        .from("members")
        .select("id,first_name,last_name,status")
        .eq("org_id", orgId)
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true }),
      supabase
        .from("attendance_sessions")
        .select(
          "id,org_id,service_category_id,session_date,status,created_at,updated_at,published_by,published_at,deleted_at,deleted_by,revision,last_edited_at,last_edited_by,last_edited_by_email",
        )
        .eq("org_id", orgId)
        .eq("status", "published")
        .order("published_at", { ascending: false }),
    ]);

    if (catsRes.error)
      return (setErr(catsRes.error.message), setLoading(false));
    if (membersRes.error)
      return (setErr(membersRes.error.message), setLoading(false));
    if (sessionsRes.error)
      return (setErr(sessionsRes.error.message), setLoading(false));

    setServiceCats((catsRes.data ?? []) as CategoryRow[]);
    setMembers((membersRes.data ?? []) as MemberRow[]);
    const ss = (sessionsRes.data ?? []) as PublishedSession[];
    setSessions(ss);

    if (!selectedSessionId && ss.length > 0) setSelectedSessionId(ss[0].id);

    setLoading(false);
  };

  const loadEntries = async (sessionId: string) => {
    if (!orgId) return;

    const res = await supabase
      .from("attendance_entries")
      .select(
        "id,org_id,session_id,service_category_id,session_date,entry_source,member_id,gender,age_group,segment,count,note,published_by,published_at",
      )
      .eq("org_id", orgId)
      .eq("session_id", sessionId)
      .order("published_at", { ascending: true });

    if (res.error) {
      setErr(res.error.message);
      setEntries([]);
      return;
    }

    setEntries((res.data ?? []) as AttendanceEntry[]);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (selectedSessionId) loadEntries(selectedSessionId);
    else setEntries([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  const filteredSessions = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;

    return sessions.filter((s) => {
      if (!showDeleted && s.deleted_at) return false;
      if (serviceFilter !== "all" && s.service_category_id !== serviceFilter)
        return false;

      if (from || to) {
        const d = new Date(s.session_date + "T12:00:00");
        if (from && d < from) return false;
        if (to && d > to) return false;
      }

      return true;
    });
  }, [sessions, showDeleted, serviceFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const stillVisible = filteredSessions.some(
      (s) => s.id === selectedSessionId,
    );
    if (stillVisible) return;

    if (filteredSessions.length > 0)
      setSelectedSessionId(filteredSessions[0].id);
    else setSelectedSessionId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceFilter, dateFrom, dateTo, showDeleted, sessions]);

  // Summary: bucket by segment + age_group + gender
  const summaryRows = useMemo(() => {
    const key = (g: string, ag: string, seg: string) => `${seg}__${ag}__${g}`;
    const map = new Map<
      string,
      { segment: string; age_group: string; gender: string; count: number }
    >();

    for (const e of entries) {
      const k = key(e.gender, e.age_group, e.segment);
      const prev = map.get(k);
      if (!prev)
        map.set(k, {
          segment: e.segment,
          age_group: e.age_group,
          gender: e.gender,
          count: e.count,
        });
      else prev.count += e.count;
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const s = a.segment.localeCompare(b.segment);
      if (s) return s;
      const ag = a.age_group.localeCompare(b.age_group);
      if (ag) return ag;
      return a.gender.localeCompare(b.gender);
    });
    return arr;
  }, [entries]);

  const totalCount = useMemo(
    () => entries.reduce((s, e) => s + e.count, 0),
    [entries],
  );

  const softDelete = async () => {
    if (!selectedSession) return;
    if (!isAdmin) return setErr("Admin only.");

    const ok = confirm(
      "Soft-delete this published attendance session? It will be hidden but retained for audit.",
    );
    if (!ok) return;

    setBusy("delete");
    setErr("");

    const { error } = await supabase.rpc("soft_delete_attendance_session", {
      p_session_id: selectedSession.id,
    });

    setBusy(null);

    if (error) return setErr(error.message);

    await loadAll();
  };

  const revertToDraft = async () => {
    if (!selectedSession) return;
    if (!isAdmin) return setErr("Admin only.");
    if (selectedSession.deleted_at)
      return setErr("Cannot revert a deleted session.");

    const ok = confirm(
      "Revert this published attendance back to draft?\n\nThis will remove the published entries and reopen the draft for edits.",
    );
    if (!ok) return;

    setBusy("revert");
    setErr("");

    const { error } = await supabase.rpc("revert_attendance_session_to_draft", {
      p_session_id: selectedSession.id,
    });

    setBusy(null);

    if (error) return setErr(error.message);

    // Session is now draft, so it will disappear from this page's list
    await loadAll();
    setSelectedSessionId(null);
  };

  const loadSessionEditHistory = async (sessionId: string) => {
    if (!orgId) return;

    setLoadingSessionHistory(true);
    const { data, error } = await supabase
      .from("attendance_session_edits")
      .select(
        "id,revision,old_service_category_id,new_service_category_id,old_service_name,new_service_name,old_session_date,new_session_date,edited_by_email,edited_at,reason",
      )
      .eq("org_id", orgId)
      .eq("session_id", sessionId)
      .order("revision", { ascending: false });
    setLoadingSessionHistory(false);

    if (error) {
      setSessionEditErr(error.message);
      setSessionEditHistory([]);
      return;
    }
    setSessionEditHistory((data ?? []) as SessionEdit[]);
  };

  const openSessionEdit = () => {
    if (!selectedSession || !canEditSession || selectedSession.deleted_at)
      return;

    setSessionEditServiceId(selectedSession.service_category_id);
    setSessionEditDate(selectedSession.session_date);
    setSessionEditReason("");
    setSessionEditErr("");
    setSessionEditHistory([]);
    setSessionEditOpen(true);
    void loadSessionEditHistory(selectedSession.id);
  };

  const saveSessionEdit = async () => {
    if (!selectedSession) return;
    if (!sessionEditServiceId || !sessionEditDate)
      return setSessionEditErr("Service and date are required.");
    if (!sessionEditReason.trim())
      return setSessionEditErr("A reason is required.");
    if (
      sessionEditServiceId === selectedSession.service_category_id &&
      sessionEditDate === selectedSession.session_date
    )
      return setSessionEditErr("Change the service or date before saving.");

    setSavingSessionEdit(true);
    setSessionEditErr("");
    const { error } = await supabase.rpc(
      "edit_published_attendance_session",
      {
        p_session_id: selectedSession.id,
        p_service_category_id: sessionEditServiceId,
        p_session_date: sessionEditDate,
        p_reason: sessionEditReason.trim(),
      },
    );
    setSavingSessionEdit(false);

    if (error) return setSessionEditErr(error.message);

    setSessionEditOpen(false);
    await Promise.all([loadAll(), loadEntries(selectedSession.id)]);
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
            <div className="text-xl font-semibold">Attendance • Published</div>
            <div className="text-sm text-slate-600">
              Immutable entries (member roll OR headcount)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/app/attendance"
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
          {/* Left: sessions + filters */}
          <div className="rounded-3xl border p-5 lg:col-span-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Published Sessions</div>
                <div className="mt-1 text-xs text-slate-600">
                  {filteredSessions.length} shown
                </div>
              </div>
              {/* <Pill>v1</Pill> */}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Service
                </div>
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
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    From
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
                    To
                  </div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              {/* <div className="flex items-center justify-between rounded-2xl border bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold">Show deleted</div>
                <input
                  type="checkbox"
                  checked={showDeleted}
                  disabled={!isAdmin}
                  onChange={(e) => setShowDeleted(e.target.checked)}
                  title={!isAdmin ? "Admin only" : "Show soft-deleted sessions"}
                />
              </div> */}

              {!isAdmin ? (
                <div className="text-xs text-slate-500">
                  Deleted sessions are visible to admins only.
                </div>
              ) : null}
            </div>

            <div className="mt-4 space-y-2">
              {filteredSessions.length === 0 ? (
                <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                  No sessions match your filters.
                </div>
              ) : (
                filteredSessions.map((s) => {
                  const active = s.id === selectedSessionId;
                  const label = `${serviceNameById.get(s.service_category_id) ?? "Service"} — ${fmtDate(s.session_date)}`;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${
                        active ? "bg-primary text-white" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{label}</div>
                          <div
                            className={`font-medium truncate ${active ? "text-white" : ""}`}
                          >
                            Published{" "}
                            {s.published_at ? fmtDate(s.published_at) : "—"}
                            {s.deleted_at ? (
                              <span className="ml-2 text-red-600">
                                • Deleted {fmtDate(s.deleted_at)}
                              </span>
                            ) : null}
                          </div>

                          <div
                            className={`text-xs truncate ${active ? "text-white/90" : "text-slate-600"}`}
                          >
                            Rev {s.revision ?? 0} • Last edit {s.last_edited_at ? fmtDate(s.last_edited_at) : "—"} • By {s.last_edited_by_email ?? "—"}

                          </div>
                        </div>
                        <div className="shrink-0">
                          <Pill>{s.deleted_at ? "Deleted" : "Published"}</Pill>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: entries + summary */}
          <div className="rounded-3xl border p-5 lg:col-span-8">
            {!selectedSession ? (
              <div className="rounded-2xl border bg-primary/15 p-4 text-sm text-slate-700">
                Select a published session.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {serviceNameById.get(
                        selectedSession.service_category_id,
                      ) ?? "Service"}{" "}
                      — {fmtDate(selectedSession.session_date)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {entries.length} published rows • Total count:{" "}
                      <b>{totalCount}</b>
                      {selectedSession.deleted_at ? (
                        <span className="ml-2 text-red-600">• Deleted</span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Pill>Rev {selectedSession.revision ?? 0}</Pill>
                      <div className="text-xs text-slate-500">
                        Last edited{" "}
                        {selectedSession.last_edited_at
                          ? fmtDateTime(selectedSession.last_edited_at)
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className={`rounded-2xl border px-4 py-2 text-sm font-semibold ${
                        !canEditSession ||
                        !!selectedSession.deleted_at ||
                        busy ||
                        savingSessionEdit
                          ? "border-slate-200 text-slate-400"
                          : "text-slate-800 hover:bg-slate-50"
                      }`}
                      disabled={
                        !canEditSession ||
                        !!selectedSession.deleted_at ||
                        !!busy ||
                        savingSessionEdit
                      }
                      onClick={openSessionEdit}
                      title={
                        !canEditSession
                          ? "Finance, admin, or owner only"
                          : selectedSession.deleted_at
                            ? "Deleted sessions cannot be edited"
                            : "Change the service or date"
                      }
                    >
                      Edit
                    </button>

                    <button
                      className={`rounded-2xl border px-4 py-2 text-sm font-semibold ${
                        !isAdmin || !!selectedSession.deleted_at || busy
                          ? "text-slate-400 border-slate-200"
                          : "text-slate-800 hover:bg-slate-50"
                      }`}
                      disabled={
                        !isAdmin || !!selectedSession.deleted_at || !!busy
                      }
                      onClick={revertToDraft}
                      title={
                        !isAdmin
                          ? "Admin only"
                          : selectedSession.deleted_at
                            ? "Already deleted"
                            : "Send back to draft"
                      }
                    >
                      {busy === "revert" ? "Reverting…" : "Revert to draft"}
                    </button>

                    <button
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                        !isAdmin || !!selectedSession.deleted_at || busy
                          ? "bg-slate-300"
                          : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={
                        !isAdmin || !!selectedSession.deleted_at || !!busy
                      }
                      onClick={softDelete}
                      title={
                        !isAdmin
                          ? "Admin only"
                          : selectedSession.deleted_at
                            ? "Already deleted"
                            : "Soft delete"
                      }
                    >
                      {busy === "delete" ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>

                {/* Summary table */}
                <div className="mt-5 rounded-3xl border bg-white">
                  <div className="border-b bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-600">
                    Computed summary (from published entries)
                  </div>
                  {summaryRows.length === 0 ? (
                    <div className="p-6 text-sm text-slate-600">
                      No summary available.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {summaryRows.map((r, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-12 items-center px-5 py-3 text-sm"
                        >
                          <div className="col-span-4 font-semibold">
                            {r.segment}
                          </div>
                          <div className="col-span-4 text-slate-700">
                            {r.age_group} • {r.gender}
                          </div>
                          <div className="col-span-4 text-right font-semibold">
                            {r.count}
                          </div>
                        </div>
                      ))}
                      <div className="grid grid-cols-12 items-center px-5 py-4 text-sm bg-slate-50">
                        <div className="col-span-8 font-semibold">Total</div>
                        <div className="col-span-4 text-right font-semibold">
                          {totalCount}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Raw entries */}
                <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                  <FloatingXScroll forceShow={true} onlyWhenOverflow={false}>
                    <div className="min-w-[1100px]">
                      <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100 rounded-t-3xl">
                        <div className="col-span-2">Source</div>
                        <div className="col-span-4">Member</div>
                        <div className="col-span-2">Gender</div>
                        <div className="col-span-2">Age</div>
                        <div className="col-span-2">Segment</div>
                        {/* <div className="col-span-1 text-right">Count</div>
                        <div className="col-span-1">Note</div> */}
                      </div>

                      {entries.length === 0 ? (
                        <div className="p-6 text-sm text-slate-600">
                          No entries loaded.
                        </div>
                      ) : (
                        <div className="divide-y">
                          {entries.map((e) => (
                            <div
                              key={e.id}
                              className="grid grid-cols-12 items-center px-5 py-4 text-sm"
                            >
                              <div className="col-span-2">{e.entry_source}</div>
                              <div className="col-span-4 font-semibold">
                                {e.member_id ? (
                                  (memberLabelById.get(e.member_id) ?? "—")
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </div>
                              <div className="col-span-2">{e.gender}</div>
                              <div className="col-span-2">{e.age_group}</div>
                              <div className="col-span-2">{e.segment}</div>
                              {/* <div className="col-span-1 text-right font-semibold">{e.count}</div>
                              <div className="col-span-1 text-slate-700 truncate">{e.note ?? "—"}</div> */}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </FloatingXScroll>
                </div>

                {/* <div className="mt-4 text-xs text-slate-500">
                  Attendance is low-stakes, but still audited: published sessions can be soft-deleted by admins (retained in DB).
                </div> */}
              </>
            )}
          </div>
        </div>
      </div>

      {sessionEditOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                Edit published attendance session
              </div>
              <div className="text-xs text-slate-600">
                Updates the session and all of its published attendance entries.
              </div>
            </div>

            <div className="space-y-4 overflow-auto px-6 py-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Service *
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={sessionEditServiceId}
                    onChange={(e) => {
                      setSessionEditServiceId(e.target.value);
                      setSessionEditErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    {serviceCats.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
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
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={sessionEditDate}
                    onChange={(e) => {
                      setSessionEditDate(e.target.value);
                      setSessionEditErr("");
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Reason *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={sessionEditReason}
                  onChange={(e) => {
                    setSessionEditReason(e.target.value);
                    setSessionEditErr("");
                  }}
                  placeholder="Why is this published session changing?"
                />
              </div>

              {sessionEditErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {sessionEditErr}
                </div>
              ) : null}

              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Revision history</div>
                  <div className="text-xs text-slate-600">
                    {sessionEditHistory.length} revision
                    {sessionEditHistory.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="mt-3">
                  {loadingSessionHistory ? (
                    <div className="text-sm text-slate-600">
                      Loading history…
                    </div>
                  ) : sessionEditHistory.length === 0 ? (
                    <div className="text-sm text-slate-600">
                      No session revisions yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sessionEditHistory.map((edit) => (
                        <div
                          key={edit.id}
                          className="rounded-xl border bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-slate-700">
                                {fmtDateTime(edit.edited_at)}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Changed by {edit.edited_by_email ?? "Unknown editor"}
                              </div>
                            </div>
                            <Pill>Rev {edit.revision}</Pill>
                          </div>

                          <div className="mt-2 space-y-1 text-sm text-slate-800">
                            {edit.old_service_category_id !==
                            edit.new_service_category_id ? (
                              <div>
                                Service: <b>{edit.old_service_name}</b> →{" "}
                                <b>{edit.new_service_name}</b>
                              </div>
                            ) : null}
                            {edit.old_session_date !== edit.new_session_date ? (
                              <div>
                                Date: <b>{fmtDate(edit.old_session_date)}</b> →{" "}
                                <b>{fmtDate(edit.new_session_date)}</b>
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-2 text-xs text-slate-600">
                            Reason: {edit.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setSessionEditOpen(false)}
                disabled={savingSessionEdit}
              >
                Cancel
              </button>
              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  savingSessionEdit
                    ? "bg-slate-300"
                    : "bg-primary hover:bg-primary/85"
                }`}
                onClick={saveSessionEdit}
                disabled={savingSessionEdit}
              >
                {savingSessionEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
