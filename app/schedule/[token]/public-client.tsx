"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getPublicMeta,
  getPublicMonth,
  submitPublic,
} from "@/lib/client/scheduleApi";
import type {
  PublicMetaResponse,
  PublicMonthResponse,
  ScheduleRole,
} from "@/lib/schedule/types";

type UiError = { message: string } | null;

type TabKey = "approved" | "signup";
type DayView = "approved" | "signup";

type DayModalState = { open: false } | { open: true; date: string };

type CalendarCell = { iso: string; day: number; inMonth: boolean };

type CatLite = { id: string; name: string };

function roleLabel(r: ScheduleRole) {
  if (r === "lead") return "Lead";
  if (r === "asst") return "Asst";
  return "Member";
}

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

  // current
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: toISODate(y, m0, d), day: d, inMonth: true });
  }

  // trailing to 42
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
 * - if >3 names OR too many total words -> show "Approved (N)" etc.
 */
function shouldCollapseNames(names: string[]) {
  if (names.length > 3) return true;
  const totalWords = names.reduce((acc, n) => acc + wordsLen(n), 0);
  return totalWords >= 10;
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;

  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
    return fallback;
  }

  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return fallback;
  }

  return fallback;
}

/**
 * Optional categories extraction (no "any"):
 * If you later add `meta.services` / `meta.departments` this will automatically pick them up.
 */
function readCategoryList(v: unknown): CatLite[] {
  if (!Array.isArray(v)) return [];
  const out: CatLite[] = [];
  for (const item of v) {
    if (
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      "name" in item
    ) {
      const id = (item as { id: unknown }).id;
      const name = (item as { name: unknown }).name;
      if (typeof id === "string" && typeof name === "string") {
        out.push({ id, name });
      }
    }
  }
  return out;
}

type ApprovedEntry = PublicMonthResponse["approved"][number];

type ApprovedByDate = Record<string, ApprovedEntry[]>;
function groupApprovedByDate(approved: ApprovedEntry[]): ApprovedByDate {
  const out: ApprovedByDate = {};
  for (const e of approved) {
    if (!out[e.date]) out[e.date] = [];
    out[e.date].push(e);
  }
  return out;
}

type PendingMap = Record<string, number>;
function pendingCountsToMap(
  pending: PublicMonthResponse["pending_counts"],
): PendingMap {
  const out: PendingMap = {};
  for (const r of pending) out[r.date] = r.count;
  return out;
}

export default function PublicScheduleClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PublicMetaResponse | null>(null);
  const [monthData, setMonthData] = useState<PublicMonthResponse | null>(null);
  const [err, setErr] = useState<UiError>(null);

  const [month, setMonth] = useState<string>(() => monthFromDate(new Date()));
  const [tab, setTab] = useState<TabKey>("approved");

  const [modal, setModal] = useState<DayModalState>({ open: false });

  // inside modal (do not reset when open/close)
  const [dayView, setDayView] = useState<DayView>("approved");

  // signup form state (in modal)
  const [signupRole, setSignupRole] = useState<ScheduleRole>("member");
  const [signupName, setSignupName] = useState("");
  const [signupNotes, setSignupNotes] = useState("");

  const [signupServiceId, setSignupServiceId] = useState<string>("");
  const [signupDeptId, setSignupDeptId] = useState<string>("");

  // Scroll freeze like admin modal
  useEffect(() => {
    if (!modal.open) return;

    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";

    return () => {
      const top = document.body.style.top;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";

      const y = top ? Math.abs(parseInt(top, 10)) : scrollY;
      window.scrollTo(0, y);
    };
  }, [modal.open]);

  async function refreshMetaAndMonth(targetMonth?: string) {
    setErr(null);
    setLoading(true);
    try {
      const m = await getPublicMeta(token);
      setMeta(m);

      const mm = targetMonth ?? m.defaultMonth;
      setMonth(mm);

      const md = await getPublicMonth(token, mm);
      setMonthData(md);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setErr({ message: msg });
      setMonthData(null);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setErr({ message: "Invalid link." });
      setLoading(false);
      return;
    }
    void refreshMetaAndMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // When month changes via nav
  useEffect(() => {
    if (!token) return;
    if (!meta) return;
    void (async () => {
      setErr(null);
      setLoading(true);
      try {
        const md = await getPublicMonth(token, month);
        setMonthData(md);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error";
        setErr({ message: msg });
      } finally {
        setLoading(false);
      }
    })();
  }, [month, meta, token]);

  const orgName = meta?.org.name ?? "Service Schedule";
  const logoPath = meta?.org.settings.logo_path ?? null;
  const useDefaultLogo = coerceBool(meta?.org.settings.use_default_logo, true);

  // Optional categories (if you add them to meta later)
  const services = useMemo(() => {
    const v: unknown =
      (meta && "services" in meta ? (meta as unknown as { services: unknown }).services : undefined);
    return readCategoryList(v);
  }, [meta]);

  const departments = useMemo(() => {
    const v: unknown =
      (meta && "departments" in meta
        ? (meta as unknown as { departments: unknown }).departments
        : undefined);
    return readCategoryList(v);
  }, [meta]);

  const approvedByDate = useMemo(
    () => groupApprovedByDate(monthData?.approved ?? []),
    [monthData],
  );

  const pendingMap = useMemo(
    () => pendingCountsToMap(monthData?.pending_counts ?? []),
    [monthData],
  );

  const { cells } = useMemo(() => buildMonthGridWithMuted(month), [month]);

  const rawDraftOpen: unknown = monthData?.month.draft_open;
  const draftOpen = coerceBool(rawDraftOpen, false);

  const modalDate = modal.open ? modal.date : null;

  const modalApproved = useMemo(() => {
    if (!modalDate) return [];
    return approvedByDate[modalDate] ?? [];
  }, [approvedByDate, modalDate]);

  const modalPendingCount = modalDate ? (pendingMap[modalDate] ?? 0) : 0;

  const canSubmit = Boolean(
    draftOpen &&
      modal.open &&
      signupName.trim().length > 0 &&
      modalDate &&
      signupDeptId &&
      signupServiceId,
  );

  function openDay(date: string) {
    setModal({ open: true, date });
    // keep dayView as-is (like admin)
  }

  function closeModal() {
    setModal({ open: false });

    // reset ONLY the signup form (like admin resets add row fields)
    setSignupNotes("");
    setSignupRole("member");
    setSignupName("");
    setSignupServiceId("");
    setSignupDeptId("");
  }

  async function handleSubmit() {
    if (!modal.open) return;
    if (!monthData) return;

    const date = modal.date;

    try {
      setErr(null);
      await submitPublic({
        token,
        month: monthData.month.month,
        date,
        service_category_id: signupServiceId,
        department_category_id: signupDeptId,
        role: signupRole,
        name: signupName.trim(),
        notes: signupNotes.trim() ? signupNotes.trim() : null,
      });

      // Refresh month data so pending badge updates
      const md = await getPublicMonth(token, monthData.month.month);
      setMonthData(md);

      closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setErr({ message: msg });
    }
  }

  const showApprovedInline = tab === "approved";
  const showPendingInline = tab === "signup";

  const preview = (names: string[]) => names.slice(0, 3).join(", ");

  return (
    <>
      {/* Top bar (matches admin layout) */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4 mt-6">
          <div className="flex items-center gap-3">
            {!useDefaultLogo && logoPath ? (
              <div className="h-10 w-10 overflow-hidden rounded-xl border bg-white">
                <img src={logoPath} alt="" className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="h-10 w-10 overflow-hidden rounded-xl border bg-white" />
            )}

            <div>
              <div className="text-xl font-semibold">Workers Schedule</div>
              <div className="text-sm text-slate-600">
                {orgName} • View approved assignments, and sign up for open days.
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-5">
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Tabs */}
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
                  tab === "signup"
                    ? "bg-white border shadow-sm"
                    : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("signup")}
              >
                Signups
              </button>
            </div>

            {/* Actions (month nav + draft banner) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-2xl border bg-white p-1">
                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, -1))}
                  aria-label="Previous month"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl
                    text-slate-600 hover:bg-slate-50
                    focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path
                      fillRule="evenodd"
                      d="M12.79 15.3a1 1 0 01-1.42 0l-5-5a1 1 0 010-1.42l5-5a1 1 0 111.42 1.42L8.91 10l3.88 3.88a1 1 0 010 1.42z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const mm = meta?.defaultMonth ?? monthFromDate(new Date());
                    setMonth(mm);
                  }}
                  className="mx-1 rounded-xl px-4 py-2 text-sm font-semibold
                    hover:bg-slate-50
                    focus-visible:ring-2 focus-visible:ring-primary/30"
                  title="Jump to default month"
                >
                  {fmtMonthTitle(month)}
                </button>

                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, 1))}
                  aria-label="Next month"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl
                    text-slate-600 hover:bg-slate-50
                    focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path
                      fillRule="evenodd"
                      d="M7.21 4.7a1 1 0 011.42 0l5 5a1 1 0 010 1.42l-5 5a1 1 0 11-1.42-1.42L11.09 10 7.21 6.12a1 1 0 010-1.42z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              <div
                className={`inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2 ${
                  draftOpen ? "border-emerald-200" : "border-amber-200"
                }`}
                title={draftOpen ? "Signups are open" : "Signups are closed"}
              >
                <div className="text-sm font-semibold text-slate-800">
                  Signups
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    draftOpen
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {draftOpen ? "Open" : "Closed"}
                </span>
              </div>
            </div>
          </div>

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
        ) : !monthData ? (
          <div className="rounded-3xl border bg-white p-6 text-sm text-slate-600">
            No data.
          </div>
        ) : (
          <>
            {tab === "signup" && !draftOpen ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Sign-ups are closed for this month.
              </div>
            ) : null}

            <div className="rounded-3xl border bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[1190px]">
                  {/* DOW header */}
                  <div
                    className="border-b bg-slate-50 text-[11px] font-semibold tracking-wide text-slate-600"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, minmax(170px, 1fr))",
                    }}
                  >
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="px-4 py-3">
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Calendar cells */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, minmax(170px, 1fr))",
                    }}
                  >
                    {cells.map((c, idx) => {
                      const approved = approvedByDate[c.iso] ?? [];
                      const pendingCount = pendingMap[c.iso] ?? 0;

                      const approvedNames = approved.map((e) => e.name).filter(Boolean);
                      const collapseApproved = shouldCollapseNames(approvedNames);

                      const isLastCol = (idx + 1) % 7 === 0;
                      const isEmpty = !c.inMonth;

                      const isClickable =
                        !isEmpty &&
                        (tab === "approved" || (tab === "signup" && draftOpen));

                      return (
                        <button
                          key={`${c.iso}-${idx}`}
                          type="button"
                          disabled={!isClickable}
                          onClick={() => {
                            if (!isClickable) return;
                            openDay(c.iso);
                          }}
                          className={[
                            "aspect-square min-h-[140px] border-t p-3 text-left transition flex flex-col",
                            isLastCol ? "" : "border-r",

                            isEmpty
                              ? "bg-slate-50/40 border-slate-100 text-slate-300 cursor-default pointer-events-none select-none"
                              : isClickable
                                ? "bg-white hover:bg-slate-50 cursor-pointer"
                                : "bg-white opacity-70 cursor-not-allowed",

                            !isEmpty && isClickable
                              ? "focus-visible:ring-2 focus-visible:ring-primary/30"
                              : "focus:outline-none",
                          ].join(" ")}
                          title={isEmpty ? "" : c.iso}
                          aria-hidden={isEmpty ? true : undefined}
                          tabIndex={isEmpty ? -1 : 0}
                        >
                          {isEmpty ? null : (
                            <>
                              <div className="flex items-start justify-between">
                                <div className="inline-flex min-w-[26px] items-center justify-center rounded-md border bg-white px-2 py-1 text-xs font-semibold text-slate-800">
                                  {c.day}
                                </div>

                                <div className="flex items-center gap-1">
                                  {pendingCount > 0 ? (
                                    <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-700">
                                      P:{pendingCount}
                                    </span>
                                  ) : null}
                                  {approved.length > 0 ? (
                                    <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-700">
                                      A:{approved.length}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="mt-4 flex-1 space-y-2 min-h-0">
                                {showApprovedInline ? (
                                  approved.length ? (
                                    <div className="rounded-xl border bg-white px-3 py-7 text-xs text-slate-700">
                                      <div className="font-semibold text-slate-800">
                                        Approved
                                      </div>
                                      <div className="mt-1 text-slate-600 whitespace-normal leading-snug line-clamp-3">
                                        {collapseApproved
                                          ? `Approved (${approved.length})`
                                          : preview(approvedNames)}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="rounded-xl border bg-white px-3 py-7 text-xs text-slate-500">
                                      <div className="font-semibold text-slate-700">
                                        Approved
                                      </div>
                                      <div className="mt-1">—</div>
                                    </div>
                                  )
                                ) : null}

                                {showPendingInline ? (
                                  pendingCount ? (
                                    <div className="rounded-xl border bg-amber-50 px-3 py-7 text-xs text-amber-900">
                                      <div className="font-semibold">
                                        Pending
                                      </div>
                                      <div className="mt-1 text-slate-600 whitespace-normal leading-snug">
                                        Pending ({pendingCount})
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="rounded-xl border bg-white px-3 py-7 text-xs text-slate-500">
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
          </>
        )}
      </div>

      {/* Day Modal */}
      {modal.open && monthData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-4xl max-h-[90vh] rounded-3xl bg-white shadow-xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
              <div>
                <div className="text-sm font-semibold">Day schedule</div>
                <div className="text-xs text-slate-600">{modal.date}</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Scroll body */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="px-6 py-6 space-y-5">
                {/* Day view tabs */}
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex rounded-2xl border bg-slate-50 p-1">
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
                    <button
                      type="button"
                      className={`rounded-2xl px-4 py-2 text-sm ${
                        dayView === "signup"
                          ? "bg-white border shadow-sm"
                          : "text-slate-600 hover:bg-white"
                      }`}
                      onClick={() => setDayView("signup")}
                      disabled={!draftOpen}
                      title={!draftOpen ? "Signups are closed" : undefined}
                    >
                      Sign up
                    </button>
                  </div>

                  {modalPendingCount ? (
                    <div className="text-xs text-slate-500">
                      Pending:{" "}
                      <span className="font-semibold">{modalPendingCount}</span>
                    </div>
                  ) : null}
                </div>

                {/* Approved list (admin-style table card) */}
                {dayView === "approved" ? (
                  <div className="rounded-3xl border bg-white overflow-hidden">
                    <div className="border-b bg-slate-50 px-5 py-4">
                      <div className="text-sm font-semibold text-slate-800">
                        Approved assignments
                      </div>
                      <div className="text-xs text-slate-600">
                        These are the final assignments for the day.
                      </div>
                    </div>

                    {modalApproved.length === 0 ? (
                      <div className="p-6 text-sm text-slate-600">
                        No approved entries yet.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-12 border-b bg-primary/15 px-5 py-3 text-xs font-semibold text-black">
                          <div className="col-span-5">Name</div>
                          <div className="col-span-2">Role</div>
                          <div className="col-span-5">Notes</div>
                        </div>

                        <div className="divide-y">
                          {modalApproved.map((e) => (
                            <div
                              key={e.id}
                              className="grid grid-cols-12 items-center px-5 py-3 text-sm bg-white hover:bg-slate-50/60"
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
                      </>
                    )}
                  </div>
                ) : (
                  // Signup form (admin-style card)
                  <div className="rounded-3xl border bg-white overflow-hidden">
                    <div className="border-b bg-slate-50 px-5 py-4">
                      <div className="text-sm font-semibold text-slate-800">
                        Submit a signup
                      </div>
                      <div className="text-xs text-slate-600">
                        Your signup will be pending approval.
                      </div>
                    </div>

                    {!draftOpen ? (
                      <div className="p-6 text-sm text-amber-800 bg-amber-50">
                        Sign-ups are closed for this month.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-12 gap-x-3 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100">
                          <div className="col-span-3">Service *</div>
                          <div className="col-span-3">Department *</div>
                          <div className="col-span-2">Role</div>
                          <div className="col-span-4">Name *</div>
                        </div>

                        <div className="grid grid-cols-12 gap-x-3 px-5 py-4">
                          <div className="col-span-3 pr-3 min-w-0">
                            <select
                              className="block w-full min-w-0 rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 border"
                              value={signupServiceId}
                              onChange={(e) => setSignupServiceId(e.target.value)}
                            >
                              <option value="">Select service</option>
                              {services.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-span-3 pr-3 min-w-0">
                            <select
                              className="block w-full min-w-0 rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 border"
                              value={signupDeptId}
                              onChange={(e) => setSignupDeptId(e.target.value)}
                            >
                              <option value="">Select department</option>
                              {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-span-2 pr-3 min-w-0">
                            <select
                              className="block w-full min-w-0 rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 border"
                              value={signupRole}
                              onChange={(e) =>
                                setSignupRole(e.target.value as ScheduleRole)
                              }
                            >
                              <option value="lead">Lead</option>
                              <option value="asst">Asst</option>
                              <option value="member">Member</option>
                            </select>
                          </div>

                          <div className="col-span-4 min-w-0">
                            <input
                              className="block w-full min-w-0 rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 border"
                              value={signupName}
                              onChange={(e) => setSignupName(e.target.value)}
                              placeholder="e.g., John A."
                            />
                          </div>
                        </div>

                        <div className="px-5 pb-5">
                          <div className="text-xs font-semibold text-slate-600 mb-2">
                            Notes (optional)
                          </div>
                          <textarea
                            className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                            value={signupNotes}
                            onChange={(e) => setSignupNotes(e.target.value)}
                            placeholder="e.g., Door 5"
                            rows={3}
                          />

                          <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={closeModal}
                              className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={!canSubmit}
                              onClick={handleSubmit}
                              className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${
                                canSubmit
                                  ? "bg-primary hover:bg-primary/85"
                                  : "bg-slate-300"
                              }`}
                            >
                              Submit
                            </button>
                          </div>

                          {/* Helpful wiring note (only when empty) */}
                          {services.length === 0 || departments.length === 0 ? (
                            <div className="mt-3 text-xs text-slate-500">
                              Service/department dropdowns are empty until you
                              expose categories on the public meta (or add a
                              public categories endpoint).
                            </div>
                          ) : null}
                        </div>
                      </>
                    )}
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
