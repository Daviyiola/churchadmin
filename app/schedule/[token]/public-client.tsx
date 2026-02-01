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

type DayModalMode = "view" | "signup";

type DayModalState =
  | { open: false }
  | { open: true; date: string; mode: DayModalMode };

function roleLabel(r: ScheduleRole) {
  if (r === "lead") return "Lead";
  if (r === "asst") return "Asst Lead";
  return "Member";
}

function isSameDay(a: string, b: string) {
  return a === b;
}

function toISODate(y: number, m1: number, d: number) {
  const mm = String(m1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function parseYYYYMM(month: string): { y: number; m1: number } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const m1 = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m1) || m1 < 1 || m1 > 12) return null;
  return { y, m1 };
}

function buildMonthGrid(month: string) {
  const parsed = parseYYYYMM(month);
  if (!parsed) return { weeks: [] as Array<Array<{ date: string | null; day: number | null }>> };

  const { y, m1 } = parsed;
  const first = new Date(y, m1 - 1, 1);
  const startDow = first.getDay(); // 0 Sun
  const daysInMonth = new Date(y, m1, 0).getDate();

  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < startDow; i++) cells.push({ date: null, day: null });

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: toISODate(y, m1, d), day: d });
  }

  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });

  const weeks: Array<Array<{ date: string | null; day: number | null }>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks };
}

type GroupedApproved = Record<
  string, // date YYYY-MM-DD
  Array<PublicMonthResponse["approved"][number]>
>;

function groupApprovedByDate(approved: PublicMonthResponse["approved"]): GroupedApproved {
  const out: GroupedApproved = {};
  for (const e of approved) {
    if (!out[e.date]) out[e.date] = [];
    out[e.date].push(e);
  }
  return out;
}

type PendingMap = Record<string, number>;
function pendingCountsToMap(pending: PublicMonthResponse["pending_counts"]): PendingMap {
  const out: PendingMap = {};
  for (const r of pending) out[r.date] = r.count;
  return out;
}

export default function PublicScheduleClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PublicMetaResponse | null>(null);
  const [monthData, setMonthData] = useState<PublicMonthResponse | null>(null);
  const [err, setErr] = useState<UiError>(null);

  const [activeTab, setActiveTab] = useState<"calendar" | "signup">("calendar");
  const [modal, setModal] = useState<DayModalState>({ open: false });

  // signup form state (in modal)
  const [signupRole, setSignupRole] = useState<ScheduleRole>("member");
  const [signupName, setSignupName] = useState("");
  const [signupNotes, setSignupNotes] = useState("");

  const [signupServiceId, setSignupServiceId] = useState<string | "">("");
  const [signupDeptId, setSignupDeptId] = useState<string | "">("");

  const defaultMonth = meta?.defaultMonth ?? "";
  const currentMonth = monthData?.month.month ?? defaultMonth;

  const { weeks } = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);

  const approvedByDate = useMemo(
    () => groupApprovedByDate(monthData?.approved ?? []),
    [monthData],
  );

  const pendingMap = useMemo(
    () => pendingCountsToMap(monthData?.pending_counts ?? []),
    [monthData],
  );

  const orgName = meta?.org.name ?? "Service Schedule";
  const logoPath = meta?.org.settings.logo_path ?? null;
  const useDefaultLogo = meta?.org.settings.use_default_logo ?? true;

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const m = await getPublicMeta(token);
      setMeta(m);

      const mm = m.defaultMonth;
      const md = await getPublicMonth(token, mm);
      setMonthData(md);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setErr({ message: msg });
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
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const departments = useMemo(() => {
    // v1: show all departments from categories (you’ll fetch these elsewhere later)
    // For now, we assume public page will call an endpoint or embed from meta later.
    // We'll keep dropdown present but empty until you wire categories.
    return [] as Array<{ id: string; name: string }>;
  }, []);

  const services = useMemo(() => {
    return [] as Array<{ id: string; name: string }>;
  }, []);

  const modalDate = modal.open ? modal.date : null;

  const modalApproved = useMemo(() => {
    if (!modalDate) return [];
    return approvedByDate[modalDate] ?? [];
  }, [approvedByDate, modalDate]);

  const modalPendingCount = modalDate ? (pendingMap[modalDate] ?? 0) : 0;

  const canSubmit = Boolean(
    monthData?.month.draft_open &&
      modal.open &&
      modal.mode === "signup" &&
      signupName.trim().length > 0 &&
      modalDate &&
      signupDeptId &&
      signupServiceId,
  );

  async function handleSubmit() {
    if (!modal.open || modal.mode !== "signup") return;
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

      // reset form
      setSignupNotes("");
      setSignupRole("member");
      setSignupName("");
      setSignupServiceId("");
      setSignupDeptId("");

      // refresh month data to update pending badge
      const md = await getPublicMonth(token, monthData.month.month);
      setMonthData(md);

      setModal({ open: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setErr({ message: msg });
    }
  }

  function openDay(date: string, mode: DayModalMode) {
    setModal({ open: true, date, mode });
  }

  function closeModal() {
    setModal({ open: false });
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Logo (optional) */}
          {!useDefaultLogo && logoPath ? (
            <div className="h-10 w-10 overflow-hidden rounded-xl border bg-white">
              {/* you likely have a component/helper to render storage paths */}
              <img
                src={logoPath}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-xl border bg-white" />
          )}

          <div>
            <div className="text-lg font-semibold">
              Service Schedule — {orgName}
            </div>
            <div className="text-xs text-slate-500">
              {currentMonth || "—"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("calendar")}
            className={`rounded-full px-3 py-1 text-sm border ${
              activeTab === "calendar"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white hover:bg-slate-50"
            }`}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("signup")}
            className={`rounded-full px-3 py-1 text-sm border ${
              activeTab === "signup"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white hover:bg-slate-50"
            }`}
          >
            Sign Up
          </button>
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-2xl border bg-red-50 p-4 text-sm text-red-700">
          {err.message}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-3xl border bg-white p-6 text-sm text-slate-600">
          Loading…
        </div>
      ) : null}

      {!loading && monthData ? (
        <>
          {/* Draft lock banner */}
          {activeTab === "signup" && !monthData.month.draft_open ? (
            <div className="mt-4 rounded-2xl border bg-amber-50 p-4 text-sm text-amber-800">
              Sign-ups are closed for this month.
            </div>
          ) : null}

          {/* Calendar grid */}
          <div className="mt-6 overflow-hidden rounded-3xl border bg-white">
            <div className="grid grid-cols-7 border-b bg-slate-50 text-xs font-medium text-slate-600">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="px-3 py-2">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {weeks.flat().map((cell, idx) => {
                const date = cell.date;
                const approved = date ? approvedByDate[date] ?? [] : [];
                const pending = date ? pendingMap[date] ?? 0 : 0;

                const isClickable =
                  Boolean(date) &&
                  (activeTab === "calendar" ||
                    (activeTab === "signup" && monthData.month.draft_open));

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={!isClickable}
                    onClick={() => {
                      if (!date) return;
                      openDay(date, activeTab === "signup" ? "signup" : "view");
                    }}
                    className={`min-h-[110px] border-t border-r p-2 text-left transition ${
                      !date
                        ? "bg-slate-50"
                        : isClickable
                          ? "hover:bg-slate-50"
                          : "bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">
                        {cell.day ?? ""}
                      </div>
                      {pending > 0 ? (
                        <div className="rounded-full border bg-white px-2 py-[2px] text-[11px] text-slate-700">
                          Pending ({pending})
                        </div>
                      ) : null}
                    </div>

                    {/* Compact approved preview */}
                    {date && approved.length ? (
                      <div className="mt-2 space-y-1">
                        {approved.slice(0, 3).map((e) => (
                          <div
                            key={e.id}
                            className="truncate text-xs text-slate-700"
                            title={`${roleLabel(e.role)}: ${e.name}`}
                          >
                            <span className="font-medium">
                              {roleLabel(e.role)}:
                            </span>{" "}
                            {e.name}
                          </div>
                        ))}
                        {approved.length > 3 ? (
                          <div className="text-xs text-slate-500">
                            +{approved.length - 3} more
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Modal */}
          {modal.open ? (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
              <div className="w-full max-w-2xl rounded-3xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b p-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {modal.mode === "signup" ? "Sign Up" : "Day Details"}
                    </div>
                    <div className="text-xs text-slate-500">{modal.date}</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border px-3 py-1 text-sm hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>

                <div className="p-4">
                  {/* Approved list */}
                  <div className="rounded-2xl border bg-slate-50 p-3">
                    <div className="text-xs font-medium text-slate-600">
                      Approved
                    </div>
                    {modalApproved.length ? (
                      <div className="mt-2 space-y-1">
                        {modalApproved.map((e) => (
                          <div key={e.id} className="text-sm text-slate-800">
                            <span className="font-semibold">
                              {roleLabel(e.role)}:
                            </span>{" "}
                            {e.name}
                            {e.notes ? (
                              <span className="text-slate-500">
                                {" "}
                                — {e.notes}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-600">
                        No approved entries yet.
                      </div>
                    )}

                    {modalPendingCount > 0 ? (
                      <div className="mt-3 text-xs text-slate-600">
                        Pending ({modalPendingCount})
                      </div>
                    ) : null}
                  </div>

                  {/* Signup form */}
                  {modal.mode === "signup" ? (
                    <div className="mt-4 rounded-2xl border p-3">
                      <div className="text-xs font-medium text-slate-600">
                        Submit a sign-up (pending approval)
                      </div>

                      {/* Service + Department: v1 placeholders */}
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="text-sm">
                          <div className="mb-1 text-xs text-slate-600">
                            Service
                          </div>
                          <select
                            className="w-full rounded-xl border px-3 py-2 text-sm"
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
                        </label>

                        <label className="text-sm">
                          <div className="mb-1 text-xs text-slate-600">
                            Department
                          </div>
                          <select
                            className="w-full rounded-xl border px-3 py-2 text-sm"
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
                        </label>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="text-sm">
                          <div className="mb-1 text-xs text-slate-600">Role</div>
                          <div className="flex gap-2">
                            {(["lead", "asst", "member"] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setSignupRole(r)}
                                className={`rounded-full border px-3 py-1 text-sm ${
                                  signupRole === r
                                    ? "bg-slate-900 text-white border-slate-900"
                                    : "bg-white hover:bg-slate-50"
                                }`}
                              >
                                {roleLabel(r)}
                              </button>
                            ))}
                          </div>
                        </label>

                        <label className="text-sm">
                          <div className="mb-1 text-xs text-slate-600">Name</div>
                          <input
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={signupName}
                            onChange={(e) => setSignupName(e.target.value)}
                            placeholder="e.g., John A."
                          />
                        </label>
                      </div>

                      <label className="mt-3 block text-sm">
                        <div className="mb-1 text-xs text-slate-600">Notes (optional)</div>
                        <textarea
                          className="w-full rounded-xl border px-3 py-2 text-sm"
                          value={signupNotes}
                          onChange={(e) => setSignupNotes(e.target.value)}
                          placeholder="e.g., Door 5"
                          rows={3}
                        />
                      </label>

                      <div className="mt-4 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={closeModal}
                          className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!canSubmit}
                          onClick={handleSubmit}
                          className={`rounded-xl px-4 py-2 text-sm text-white ${
                            canSubmit ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300"
                          }`}
                        >
                          Submit
                        </button>
                      </div>

                      {/* Clear warning if departments/services aren't wired yet */}
                      {services.length === 0 || departments.length === 0 ? (
                        <div className="mt-3 text-xs text-slate-500">
                          Note: service/department dropdowns are empty until you wire categories
                          into this public page (we’ll do that next).
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
