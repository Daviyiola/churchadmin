"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveOrgId, getAccessToken } from "@/lib/auth";
import {
  getAdminMonth,
  patchAdminMonthSettings,
  patchAdminEntry,
  createAdminEntry,
} from "@/lib/client/scheduleApi";
import type {
  AdminMonthResponse,
  ScheduleRole,
  ScheduleStatus,
} from "@/lib/schedule/types";

type UiError = { message: string } | null;

type Entry = AdminMonthResponse["entries"][number];

type CategoryLite = { id: string; name: string };
type AddMode = "approved" | "pending";
type TabKey = "approved" | "draft";
type DayView = "approved" | "pending";

type DayModalState = { open: false } | { open: true; date: string };

type CalendarCell = { iso: string; day: number; inMonth: boolean };

function monthFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonths(yyyyMm: string, delta: number) {
  const m = yyyyMm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return yyyyMm;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dt = new Date(y, mo, 1);
  dt.setMonth(dt.getMonth() + delta);
  return monthFromDate(dt);
}

function parseYYYYMM(month: string): { y: number; m0: number } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const m0 = Number(m[2]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(m0) || m0 < 0 || m0 > 11)
    return null;
  return { y, m0 };
}

function toISODate(y: number, m0: number, d: number) {
  const m1 = m0 + 1;
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fmtMonthTitle(yyyyMm: string) {
  const p = parseYYYYMM(yyyyMm);
  if (!p) return yyyyMm;
  const dt = new Date(p.y, p.m0, 1);
  return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function roleLabel(r: ScheduleRole) {
  if (r === "lead") return "Lead";
  if (r === "asst") return "Asst";
  return "Member";
}

function groupByDate(entries: Entry[]) {
  const m: Record<string, Entry[]> = {};
  for (const e of entries) {
    if (!m[e.date]) m[e.date] = [];
    m[e.date].push(e);
  }
  return m;
}

/**
 * 6-week (42 cell) month grid, includes muted adjacent-month days.
 */
function buildMonthGridWithMuted(month: string) {
  const p = parseYYYYMM(month);
  if (!p) return { cells: [] as CalendarCell[] };
  const { y, m0 } = p;

  const first = new Date(y, m0, 1);
  const startDow = first.getDay(); // 0..6 (Sun..Sat)
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const prevMonthLastDay = new Date(y, m0, 0).getDate();

  const cells: CalendarCell[] = [];

  // leading
  for (let i = 0; i < startDow; i++) {
    const d = prevMonthLastDay - (startDow - 1 - i);
    const prev = new Date(y, m0 - 1, d);
    cells.push({
      iso: toISODate(prev.getFullYear(), prev.getMonth(), prev.getDate()),
      day: d,
      inMonth: false,
    });
  }

  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: toISODate(y, m0, d), day: d, inMonth: true });
  }

  // trailing
  const need = 42 - cells.length;
  for (let i = 1; i <= need; i++) {
    const next = new Date(y, m0 + 1, i);
    cells.push({
      iso: toISODate(next.getFullYear(), next.getMonth(), next.getDate()),
      day: i,
      inMonth: false,
    });
  }

  return { cells };
}

function wordsLen(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Collapse rule:
 * - if >3 names OR too many total words -> show "Pending (N)" etc.
 */
function shouldCollapseNames(names: string[]) {
  if (names.length > 3) return true;
  const totalWords = names.reduce((acc, n) => acc + wordsLen(n), 0);
  return totalWords >= 10; // tweak
}

function byAlpha(a: CategoryLite, b: CategoryLite) {
  return a.name.localeCompare(b.name);
}

type PublicLinkResponse = { publicUrl: string };

export default function AdminSchedulePage() {
  const [orgId, setOrgId] = useState<string>("");
  const [jwt, setJwt] = useState<string>("");

  const [month, setMonth] = useState<string>(() => monthFromDate(new Date()));
  const [data, setData] = useState<AdminMonthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<UiError>(null);

  // Top-level tabs (like Categories)
  const [tab, setTab] = useState<TabKey>("approved");

  // Day modal
  const [modal, setModal] = useState<DayModalState>({ open: false });

  // Remember last view inside the day modal (do NOT reset on open/close)
  const [dayView, setDayView] = useState<DayView>("pending");

  // Add form (in modal)
  const [addMode, setAddMode] = useState<AddMode>("approved");
  const [addName, setAddName] = useState<string>("");
  const [addRole, setAddRole] = useState<ScheduleRole>("member");
  const [addNotes, setAddNotes] = useState<string>("");

  // Service/Department pickers (typeahead + quick add)
  const [serviceCats, setServiceCats] = useState<CategoryLite[]>([]);
  const [deptCats, setDeptCats] = useState<CategoryLite[]>([]);
  const [catErr, setCatErr] = useState<string>("");

  const [serviceId, setServiceId] = useState<string>("");
  const [serviceQuery, setServiceQuery] = useState<string>("");
  const [serviceOpen, setServiceOpen] = useState<boolean>(false);

  const [deptId, setDeptId] = useState<string>("");
  const [deptQuery, setDeptQuery] = useState<string>("");
  const [deptOpen, setDeptOpen] = useState<boolean>(false);

  const serviceIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of serviceCats) m.set(c.name.trim().toLowerCase(), c.id);
    return m;
  }, [serviceCats]);

  const deptIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of deptCats) m.set(c.name.trim().toLowerCase(), c.id);
    return m;
  }, [deptCats]);

  // ✅ Replace these with your real endpoints (you said these already work)
  async function fetchServices(
    _orgId: string,
    _jwt: string,
  ): Promise<CategoryLite[]> {
    return [];
  }
  async function fetchDepartments(
    _orgId: string,
    _jwt: string,
  ): Promise<CategoryLite[]> {
    return [];
  }
  async function quickAddCategory(
    _kind: "service" | "department",
    name: string,
  ): Promise<CategoryLite> {
    // Replace with your endpoint. Must return { id, name }
    return { id: crypto.randomUUID(), name };
  }

  useEffect(() => {
    (async () => {
      try {
        const oid = await getActiveOrgId();
        const token = await getAccessToken();
        setOrgId(oid ?? "");
        setJwt(token ?? "");
      } catch (e) {
        setErr({ message: e instanceof Error ? e.message : "Error" });
      }
    })();
  }, []);

  async function refresh(m: string) {
    if (!orgId || !jwt) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await getAdminMonth(orgId, m, jwt);
      setData(res);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!orgId || !jwt) return;

    void refresh(month);

    (async () => {
      try {
        setCatErr("");
        const [sv, dp] = await Promise.all([
          fetchServices(orgId, jwt),
          fetchDepartments(orgId, jwt),
        ]);
        setServiceCats((sv ?? []).slice().sort(byAlpha));
        setDeptCats((dp ?? []).slice().sort(byAlpha));
      } catch (e) {
        setCatErr(e instanceof Error ? e.message : "Failed to load categories");
        setServiceCats([]);
        setDeptCats([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, jwt, month]);

  const entries = data?.entries ?? [];
  const byDate = useMemo(() => groupByDate(entries), [entries]);
  const { cells } = useMemo(() => buildMonthGridWithMuted(month), [month]);

  const draftOpen = data?.month.draft_open ?? true;

  const modalDate = modal.open ? modal.date : null;
  const modalEntries = useMemo(
    () => (modalDate ? (byDate[modalDate] ?? []) : []),
    [modalDate, byDate],
  );

  const modalPending = useMemo(
    () => modalEntries.filter((e) => e.status === "pending"),
    [modalEntries],
  );
  const modalApproved = useMemo(
    () => modalEntries.filter((e) => e.status === "approved"),
    [modalEntries],
  );
  const modalRejected = useMemo(
    () => modalEntries.filter((e) => e.status === "rejected"),
    [modalEntries],
  );

  function openDay(date: string) {
    setModal({ open: true, date });
    // ✅ remember last dayView: do nothing
  }

  function closeModal() {
    setModal({ open: false });
    setAddMode("approved");
    setAddName("");
    setAddNotes("");
    setAddRole("member");

    // keep pickers sticky or reset? resetting keeps it clean
    setServiceId("");
    setServiceQuery("");
    setDeptId("");
    setDeptQuery("");
    setServiceOpen(false);
    setDeptOpen(false);
  }

  async function toggleDraft(open: boolean) {
    if (!orgId || !jwt) return;
    try {
      await patchAdminMonthSettings(
        { org_id: orgId, month, draft_open: open },
        jwt,
      );
      await refresh(month);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
    }
  }

  async function setEntryStatus(entryId: string, status: ScheduleStatus) {
    if (!orgId || !jwt) return;
    try {
      await patchAdminEntry({ org_id: orgId, entry_id: entryId, status }, jwt);
      await refresh(month);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
    }
  }

  async function addEntry() {
    if (!orgId || !jwt || !modalDate) return;
    const nm = addName.trim();
    if (!nm) return;

    let svcId: string | null = serviceId || null;
    let depId: string | null = deptId || null;

    // quick add if typed but not selected
    if (!svcId && serviceQuery.trim()) {
      try {
        const created = await quickAddCategory("service", serviceQuery.trim());
        setServiceCats((cur) => [...cur, created].sort(byAlpha));
        svcId = created.id;
        setServiceId(created.id);
        setServiceQuery(created.name);
      } catch (e) {
        setErr({
          message: e instanceof Error ? e.message : "Failed to add service",
        });
        return;
      }
    }

    if (!depId && deptQuery.trim()) {
      try {
        const created = await quickAddCategory("department", deptQuery.trim());
        setDeptCats((cur) => [...cur, created].sort(byAlpha));
        depId = created.id;
        setDeptId(created.id);
        setDeptQuery(created.name);
      } catch (e) {
        setErr({
          message: e instanceof Error ? e.message : "Failed to add department",
        });
        return;
      }
    }

    try {
      await createAdminEntry(
        {
          org_id: orgId,
          month,
          date: modalDate,
          service_category_id: svcId,
          department_category_id: depId,
          role: addRole,
          name: nm,
          notes: addNotes.trim() ? addNotes.trim() : null,
          status: addMode === "pending" ? "pending" : "approved",
        },
        jwt,
      );

      setAddName("");
      setAddNotes("");
      setAddRole("member");
      await refresh(month);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
    }
  }

  const serviceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of serviceCats) m.set(c.id, c.name);
    return m;
  }, [serviceCats]);

  const deptNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of deptCats) m.set(c.id, c.name);
    return m;
  }, [deptCats]);

  function groupByServiceDept(items: Entry[]) {
    const m: Record<string, Entry[]> = {};
    for (const e of items) {
      const svc = e.service_category_id
        ? serviceNameById.get(e.service_category_id) || "—"
        : "—";
      const dep = e.department_category_id
        ? deptNameById.get(e.department_category_id) || "—"
        : "—";
      const key = `${svc} • ${dep}`;
      if (!m[key]) m[key] = [];
      m[key].push(e);
    }
    return Object.keys(m)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ key: k, rows: m[k] }));
  }

  const pendingGroups = useMemo(
    () => groupByServiceDept(modalPending),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modalDate, modalPending, serviceNameById, deptNameById],
  );

  const approvedGroups = useMemo(
    () => groupByServiceDept(modalApproved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modalDate, modalApproved, serviceNameById, deptNameById],
  );

  // Typeahead helpers
  const filteredServices = useMemo(() => {
    const needle = serviceQuery.trim().toLowerCase();
    if (!needle) return serviceCats.slice(0, 40);
    return serviceCats
      .filter((c) => c.name.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [serviceCats, serviceQuery]);

  const filteredDepts = useMemo(() => {
    const needle = deptQuery.trim().toLowerCase();
    if (!needle) return deptCats.slice(0, 40);
    return deptCats
      .filter((c) => c.name.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [deptCats, deptQuery]);

  const showAddServiceRow = useMemo(() => {
    const clean = serviceQuery.trim();
    if (!clean) return false;
    return !serviceIdByLabel.has(clean.toLowerCase());
  }, [serviceQuery, serviceIdByLabel]);

  const showAddDeptRow = useMemo(() => {
    const clean = deptQuery.trim();
    if (!clean) return false;
    return !deptIdByLabel.has(clean.toLowerCase());
  }, [deptQuery, deptIdByLabel]);

  // ---------- render ----------
  return (
    <>
      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Service Schedule</div>
            <div className="text-sm text-slate-600">{fmtMonthTitle(month)}</div>
          </div>

          <div className="flex items-center gap-2">
            {/* Month nav */}
            <div className="inline-flex items-center rounded-2xl border bg-white p-1">
              <button
                type="button"
                className="rounded-2xl px-3 py-2 text-sm hover:bg-slate-50"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                title="Previous month"
              >
                ←
              </button>
              <button
                type="button"
                className="rounded-2xl px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                onClick={() => setMonth(monthFromDate(new Date()))}
                title="Jump to current month"
              >
                Current month
              </button>
              <button
                type="button"
                className="rounded-2xl px-3 py-2 text-sm hover:bg-slate-50"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                title="Next month"
              >
                →
              </button>
            </div>

            <button
              type="button"
              onClick={async () => {
                if (!orgId || !jwt) return;
                try {
                  const res = await fetch(
                    `/api/schedule/admin/public-link?org_id=${encodeURIComponent(orgId)}`,
                    { headers: { Authorization: `Bearer ${jwt}` } },
                  );
                  if (!res.ok) throw new Error("Request failed");
                  const json: PublicLinkResponse =
                    (await res.json()) as PublicLinkResponse;
                  if (!json.publicUrl) throw new Error("Missing publicUrl");
                  await navigator.clipboard.writeText(json.publicUrl);
                } catch {
                  setErr({ message: "Failed to copy public link." });
                }
              }}
              className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
            >
              Copy public link
            </button>

            {/* Draft signups toggle */}
            <div className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2">
              <div className="text-sm font-semibold text-slate-800">
                Draft signups
              </div>
              <button
                type="button"
                onClick={() => toggleDraft(!draftOpen)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  draftOpen ? "bg-emerald-600" : "bg-slate-300"
                }`}
                title={
                  draftOpen ? "Draft signups: Open" : "Draft signups: Closed"
                }
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    draftOpen ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="px-6 pb-5">
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl border bg-slate-50 p-1">
              <button
                type="button"
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === "approved"
                    ? "bg-white border shadow-sm"
                    : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("approved")}
              >
                Approved
              </button>
              <button
                type="button"
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === "draft"
                    ? "bg-white border shadow-sm"
                    : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("draft")}
              >
                Draft
              </button>
            </div>

            <div className="text-sm text-slate-600">
              Click any day to review signups, approve/reject, or add
              assignments.
            </div>
          </div>

          {catErr ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Service/Department lists could not be loaded: {catErr}
            </div>
          ) : null}

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err.message}
            </div>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        {loading ? (
          <div className="rounded-3xl border bg-white p-6 text-sm text-slate-600">
            Loading…
          </div>
        ) : !data ? (
          <div className="rounded-3xl border bg-white p-6 text-sm text-slate-600">
            No data.
          </div>
        ) : (
          <div className="rounded-3xl border bg-white overflow-hidden">
            <div className="overflow-x-auto">
              {/* this allows horizontal scroll if screen is too small */}
              <div className="min-w-[1190px]">
                {/* DOW header */}
                <div
                  className="border-b bg-slate-50 text-[11px] font-semibold tracking-wide text-slate-600"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(170px, 1fr))",
                  }}
                >
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (d) => (
                      <div key={d} className="px-4 py-3">
                        {d}
                      </div>
                    ),
                  )}
                </div>

                {/* Calendar cells */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(170px, 1fr))",
                  }}
                >
                  {cells.map((c, idx) => {
                    const dayEntries = byDate[c.iso] ?? [];
                    const pending = dayEntries.filter(
                      (e) => e.status === "pending",
                    );
                    const approved = dayEntries.filter(
                      (e) => e.status === "approved",
                    );

                    const pendingNames = pending
                      .map((e) => e.name)
                      .filter(Boolean);
                    const approvedNames = approved
                      .map((e) => e.name)
                      .filter(Boolean);

                    const collapsePending = shouldCollapseNames(pendingNames);
                    const collapseApproved = shouldCollapseNames(approvedNames);

                    const isLastCol = (idx + 1) % 7 === 0;

                    // show BOTH badges always; show ONE detail box based on tab
                    const showApprovedInline = tab === "approved";
                    const showPendingInline = tab === "draft";

                    const preview = (names: string[]) =>
                      names.slice(0, 3).join(", ");

                    const isEmpty = !c.inMonth;

                    return (
                      <button
                        key={`${c.iso}-${idx}`}
                        type="button"
                        disabled={isEmpty}
                        onClick={() => {
                          if (isEmpty) return;
                          openDay(c.iso);
                        }}
                        className={[
                          // layout
                          "aspect-square min-h-[140px] border-t p-3 text-left transition",
                          isLastCol ? "" : "border-r",

                          // in-month
                          !isEmpty ? "bg-white hover:bg-slate-50" : "",

                          // out-of-month: “disappear”
                          isEmpty
                            ? "bg-transparent border-transparent pointer-events-none select-none"
                            : "cursor-pointer",

                          // accessibility (only for real days)
                          !isEmpty
                            ? "focus-visible:ring-2 focus-visible:ring-primary/30"
                            : "focus:outline-none",
                        ].join(" ")}
                        title={isEmpty ? "" : c.iso}
                        aria-hidden={isEmpty ? true : undefined}
                        tabIndex={isEmpty ? -1 : 0}
                      >
                        {isEmpty ? null : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="inline-flex min-w-[26px] items-center justify-center rounded-md border bg-white px-2 py-1 text-xs font-semibold text-slate-800">
                                {c.day}
                              </div>

                              <div className="flex items-center gap-1">
                                {pending.length > 0 ? (
                                  <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-700">
                                    Pending {pending.length}
                                  </span>
                                ) : null}
                                {approved.length > 0 ? (
                                  <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-700">
                                    Approved {approved.length}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 space-y-2">
                              {showApprovedInline ? (
                                approved.length ? (
                                  <div className="rounded-xl border bg-white px-3 py-2 text-xs text-slate-700">
                                    <div className="font-semibold text-slate-800">
                                      Approved
                                    </div>
                                    <div className="mt-1 truncate text-slate-600">
                                      {collapseApproved
                                        ? `Approved (${approved.length})`
                                        : preview(approvedNames)}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-xl border bg-white px-3 py-2 text-xs text-slate-500">
                                    <div className="font-semibold text-slate-700">
                                      Approved
                                    </div>
                                    <div className="mt-1">—</div>
                                  </div>
                                )
                              ) : null}

                              {showPendingInline ? (
                                pending.length ? (
                                  <div className="rounded-xl border bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    <div className="font-semibold">Pending</div>
                                    <div className="mt-1 truncate">
                                      {collapsePending
                                        ? `Pending (${pending.length})`
                                        : preview(pendingNames)}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-xl border bg-white px-3 py-2 text-xs text-slate-500">
                                    <div className="font-semibold text-slate-700">
                                      Pending
                                    </div>
                                    <div className="mt-1">—</div>
                                  </div>
                                )
                              ) : null}
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Day Modal */}
      {modal.open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-4xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <div className="text-sm font-semibold">Day schedule</div>
                <div className="text-xs text-slate-600">{modal.date}</div>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex rounded-2xl border bg-slate-50 p-1">
                  <button
                    type="button"
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      dayView === "pending"
                        ? "bg-white border shadow-sm"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    onClick={() => setDayView("pending")}
                  >
                    Pending ({modalPending.length})
                  </button>
                  <button
                    type="button"
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      dayView === "approved"
                        ? "bg-white border shadow-sm"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    onClick={() => setDayView("approved")}
                  >
                    Approved ({modalApproved.length})
                  </button>
                </div>

                {modalRejected.length ? (
                  <div className="text-xs text-slate-500">
                    Rejected:{" "}
                    <span className="font-semibold">
                      {modalRejected.length}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Pending / Approved lists */}
              {dayView === "pending" ? (
                <div className="rounded-3xl border bg-white overflow-hidden">
                  <div className="border-b bg-slate-50 px-5 py-4">
                    <div className="text-sm font-semibold text-slate-800">
                      Pending signups
                    </div>
                    <div className="text-xs text-slate-600">
                      Approve or reject individual signups.
                    </div>
                  </div>

                  {pendingGroups.length === 0 ? (
                    <div className="p-6 text-sm text-slate-600">
                      No pending entries.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {pendingGroups.map((g) => (
                        <details key={g.key} open className="group">
                          <summary className="cursor-pointer list-none px-5 py-4 hover:bg-slate-50">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-slate-800">
                                {g.key}
                              </div>
                              <div className="text-xs text-slate-600">
                                {g.rows.length}{" "}
                                {g.rows.length === 1 ? "signup" : "signups"}
                              </div>
                            </div>
                          </summary>

                          <div className="border-t bg-white">
                            <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100">
                              <div className="col-span-4">Name</div>
                              <div className="col-span-2">Role</div>
                              <div className="col-span-4">Notes</div>
                              <div className="col-span-2 text-right">
                                Actions
                              </div>
                            </div>

                            <div className="divide-y">
                              {g.rows.map((e) => (
                                <div
                                  key={e.id}
                                  className="grid grid-cols-12 items-center px-5 py-3 text-sm"
                                >
                                  <div className="col-span-4 font-semibold text-slate-900">
                                    {e.name}
                                  </div>
                                  <div className="col-span-2 text-slate-700">
                                    {roleLabel(e.role)}
                                  </div>
                                  <div className="col-span-4 text-slate-700">
                                    {e.notes ? (
                                      e.notes
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </div>
                                  <div className="col-span-2 flex justify-end gap-2">
                                    <button
                                      type="button"
                                      className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                                      onClick={() =>
                                        setEntryStatus(e.id, "approved")
                                      }
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-xl bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                                      onClick={() =>
                                        setEntryStatus(e.id, "rejected")
                                      }
                                    >
                                      Reject
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-3xl border bg-white overflow-hidden">
                  <div className="border-b bg-slate-50 px-5 py-4">
                    <div className="text-sm font-semibold text-slate-800">
                      Approved assignments
                    </div>
                    <div className="text-xs text-slate-600">
                      These are the final assignments for the day.
                    </div>
                  </div>

                  {approvedGroups.length === 0 ? (
                    <div className="p-6 text-sm text-slate-600">
                      No approved entries.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {approvedGroups.map((g) => (
                        <details key={g.key} open className="group">
                          <summary className="cursor-pointer list-none px-5 py-4 hover:bg-slate-50">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-slate-800">
                                {g.key}
                              </div>
                              <div className="text-xs text-slate-600">
                                {g.rows.length}{" "}
                                {g.rows.length === 1
                                  ? "assignment"
                                  : "assignments"}
                              </div>
                            </div>
                          </summary>

                          <div className="border-t bg-white">
                            <div className="grid grid-cols-12 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100">
                              <div className="col-span-5">Name</div>
                              <div className="col-span-2">Role</div>
                              <div className="col-span-5">Notes</div>
                            </div>

                            <div className="divide-y">
                              {g.rows.map((e) => (
                                <div
                                  key={e.id}
                                  className="grid grid-cols-12 items-center px-5 py-3 text-sm"
                                >
                                  <div className="col-span-5 font-semibold text-slate-900">
                                    {e.name}
                                  </div>
                                  <div className="col-span-2 text-slate-700">
                                    {roleLabel(e.role)}
                                  </div>
                                  <div className="col-span-5 text-slate-700">
                                    {e.notes ? (
                                      e.notes
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Manual Add */}
              <div className="rounded-3xl border bg-white overflow-hidden">
                <div className="border-b bg-slate-50 px-5 py-4">
                  <div className="text-sm font-semibold text-slate-800">
                    Add new
                  </div>
                  <div className="text-xs text-slate-600">
                    Date is inferred from the selected cell.
                  </div>
                </div>

                <div className="px-5 py-5 space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="text-sm">
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Add as
                      </div>
                      <select
                        className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                        value={addMode}
                        onChange={(e) =>
                          setAddMode(
                            e.target.value === "pending"
                              ? "pending"
                              : "approved",
                          )
                        }
                      >
                        <option value="approved">Approved</option>
                        <option value="pending">Pending</option>
                      </select>
                    </label>

                    <label className="text-sm">
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Role
                      </div>
                      <select
                        className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                        value={addRole}
                        onChange={(e) =>
                          setAddRole(e.target.value as ScheduleRole)
                        }
                      >
                        <option value="lead">Lead</option>
                        <option value="asst">Asst</option>
                        <option value="member">Member</option>
                      </select>
                    </label>

                    <label className="text-sm">
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Name *
                      </div>
                      <input
                        className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                        value={addName}
                        onChange={(e) => setAddName(e.target.value)}
                        placeholder="e.g., John A."
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {/* Service */}
                    <div className="relative">
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Service (optional)
                      </div>
                      <input
                        className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                        value={serviceQuery}
                        onFocus={() => setServiceOpen(true)}
                        onBlur={() =>
                          window.setTimeout(() => setServiceOpen(false), 120)
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setServiceQuery(v);
                          const id = serviceIdByLabel.get(
                            v.trim().toLowerCase(),
                          );
                          setServiceId(id ?? "");
                          setServiceOpen(true);
                        }}
                        placeholder="Type a service…"
                      />

                      {serviceOpen ? (
                        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-auto">
                          {filteredServices.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-600">
                              No matches.
                            </div>
                          ) : (
                            filteredServices.map((c) => (
                              <button
                                type="button"
                                key={c.id}
                                className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setServiceId(c.id);
                                  setServiceQuery(c.name);
                                  setServiceOpen(false);
                                }}
                              >
                                {c.name}
                              </button>
                            ))
                          )}

                          {showAddServiceRow ? (
                            <div className="border-t">
                              <button
                                type="button"
                                className="block w-full px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={async () => {
                                  const clean = serviceQuery.trim();
                                  if (!clean) return;
                                  try {
                                    const created = await quickAddCategory(
                                      "service",
                                      clean,
                                    );
                                    setServiceCats((cur) =>
                                      [...cur, created].sort(byAlpha),
                                    );
                                    setServiceId(created.id);
                                    setServiceQuery(created.name);
                                    setServiceOpen(false);
                                  } catch (e) {
                                    setErr({
                                      message:
                                        e instanceof Error
                                          ? e.message
                                          : "Failed to add service",
                                    });
                                  }
                                }}
                              >
                                + Add service
                                {serviceQuery.trim()
                                  ? `: “${serviceQuery.trim()}”`
                                  : ""}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Department */}
                    <div className="relative">
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Department (optional)
                      </div>
                      <input
                        className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                        value={deptQuery}
                        onFocus={() => setDeptOpen(true)}
                        onBlur={() =>
                          window.setTimeout(() => setDeptOpen(false), 120)
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setDeptQuery(v);
                          const id = deptIdByLabel.get(v.trim().toLowerCase());
                          setDeptId(id ?? "");
                          setDeptOpen(true);
                        }}
                        placeholder="Type a department…"
                      />

                      {deptOpen ? (
                        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-auto">
                          {filteredDepts.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-600">
                              No matches.
                            </div>
                          ) : (
                            filteredDepts.map((c) => (
                              <button
                                type="button"
                                key={c.id}
                                className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setDeptId(c.id);
                                  setDeptQuery(c.name);
                                  setDeptOpen(false);
                                }}
                              >
                                {c.name}
                              </button>
                            ))
                          )}

                          {showAddDeptRow ? (
                            <div className="border-t">
                              <button
                                type="button"
                                className="block w-full px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={async () => {
                                  const clean = deptQuery.trim();
                                  if (!clean) return;
                                  try {
                                    const created = await quickAddCategory(
                                      "department",
                                      clean,
                                    );
                                    setDeptCats((cur) =>
                                      [...cur, created].sort(byAlpha),
                                    );
                                    setDeptId(created.id);
                                    setDeptQuery(created.name);
                                    setDeptOpen(false);
                                  } catch (e) {
                                    setErr({
                                      message:
                                        e instanceof Error
                                          ? e.message
                                          : "Failed to add department",
                                    });
                                  }
                                }}
                              >
                                + Add department
                                {deptQuery.trim()
                                  ? `: “${deptQuery.trim()}”`
                                  : ""}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Notes (optional)
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      value={addNotes}
                      onChange={(e) => setAddNotes(e.target.value)}
                      placeholder="e.g., Door 5"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={addEntry}
                      disabled={addName.trim().length === 0}
                      className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${
                        addName.trim().length
                          ? "bg-primary hover:bg-primary/85"
                          : "bg-slate-300"
                      }`}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Rejected */}
              {modalRejected.length ? (
                <div className="rounded-3xl border bg-slate-50 p-5">
                  <div className="text-xs font-semibold text-slate-600">
                    Rejected
                  </div>
                  <div className="mt-2 space-y-1">
                    {modalRejected.slice(0, 10).map((e) => (
                      <div key={e.id} className="text-sm text-slate-700">
                        {roleLabel(e.role)}: {e.name}
                      </div>
                    ))}
                    {modalRejected.length > 10 ? (
                      <div className="text-xs text-slate-500">
                        +{modalRejected.length - 10} more
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
