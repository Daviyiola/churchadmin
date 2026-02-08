"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getPublicMeta,
  getPublicMonth,
  submitPublic,
  getPublicCategories,
  verifyPublicMonthCode,
  getPublicDay,
  patchPublicEntry,
} from "@/lib/client/scheduleApi";
import type {
  PublicDayResponse,
  PublicMetaResponse,
  PublicMonthResponse,
  ScheduleRole,
} from "@/lib/schedule/types";

import { supabase } from "@/lib/supabaseClient";
import Image from "next/image";

type UiError = { message: string } | null;

type TabKey = "approved" | "pending";
type DayView = "approved" | "pending";

type DayModalState = { open: false } | { open: true; date: string };

type CalendarCell = { iso: string; day: number; inMonth: boolean };

type CatLite = { id: string; name: string };

type PublicEntryLite = {
  id: string;
  name: string;
  role: ScheduleRole;
  notes: string | null;
  service_category_id: string | null;
  department_category_id: string | null;
};

type PendingEntry = NonNullable<PublicDayResponse>["pending"][number];

type PendingGroup = {
  key: string;
  service_category_id: string | null;
  department_category_id: string | null;
  rows: PendingEntry[];
};

function groupByServiceDeptPublic(
  items: PublicEntryLite[],
  serviceNameById: Map<string, string>,
  deptNameById: Map<string, string>,
) {
  const m: Record<string, PublicEntryLite[]> = {};
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

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

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

function normalizeCategoryName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

type ServiceGroupSummary = {
  serviceLabel: string;
  total: number;
  namesPreview: string;
};

function previewNames(names: string[], maxChars = 60) {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "—";

  let out = "";
  let used = 0;

  for (let i = 0; i < clean.length; i++) {
    const next = (i === 0 ? "" : ", ") + clean[i];
    if (used + next.length > maxChars) return out.trim() + "…";
    out += next;
    used += next.length;
  }
  return out;
}

function summarizeApprovedByService(
  items: ApprovedEntry[],
  serviceNameById: Map<string, string>,
  opts?: { maxServices?: number; maxNamesChars?: number },
): { shown: ServiceGroupSummary[]; overflowServices: number } {
  const maxServices = opts?.maxServices ?? 1;
  const maxNamesChars = opts?.maxNamesChars ?? 50;

  const g = new Map<string, ApprovedEntry[]>();
  for (const e of items) {
    const sid = String(e.service_category_id ?? "");
    const key = sid || "__none__";
    if (!g.has(key)) g.set(key, []);
    g.get(key)!.push(e);
  }

  const groups: ServiceGroupSummary[] = Array.from(g.entries()).map(
    ([sid, rows]) => {
      const label = sid === "__none__" ? "—" : serviceNameById.get(sid) || "—";
      const names = rows.map((r) => r.name).filter(Boolean);

      return {
        serviceLabel: label,
        total: rows.length,
        namesPreview: shouldCollapseNames(names)
          ? `${rows.length} people`
          : previewNames(names, maxNamesChars),
      };
    },
  );

  groups.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.serviceLabel.localeCompare(b.serviceLabel);
  });

  const shown = groups.slice(0, maxServices);
  return { shown, overflowServices: Math.max(0, groups.length - shown.length) };
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

  // Calendar filter
  const [deptFilterId, setDeptFilterId] = useState<string>("");

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
      const [m, cats] = await Promise.all([
        getPublicMeta(token),
        getPublicCategories(token),
      ]);

      setMeta(m);
      setServices(cats.services ?? []);
      setDepartments(cats.departments ?? []);

      const mm = targetMonth ?? m.defaultMonth;
      setMonth(mm);

      const md = await getPublicMonth(token, mm);
      setMonthData(md);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setErr({ message: msg });
      setMonthData(null);
      setMeta(null);
      setServices([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }

  const [dayData, setDayData] = useState<PublicDayResponse | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [showSignupRow, setShowSignupRow] = useState(false);

  async function refreshDay(dateOverride?: string) {
    if (!monthData) return;
    const date = dateOverride ?? (modal.open ? modal.date : null);
    if (!date) return;
    const res = await getPublicDay(token, monthData.month.month, date);
    setDayData(res);
  }

  async function refreshMonth() {
    if (!monthData) return;
    const md = await getPublicMonth(token, monthData.month.month);
    setMonthData(md);
  }

  async function setPublicEntryStatus(
    entryId: string,
    status: "pending" | "approved" | "rejected",
  ) {
    if (!canEdit || !monthData) {
      setErr({ message: "Edit mode is not enabled." });
      return;
    }
    try {
      setErr(null);
      await patchPublicEntry({
        token,
        month: monthData.month.month,
        month_code: editCode,
        entry_id: entryId,
        status,
      });
      await Promise.all([refreshDay(), refreshMonth()]);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
    }
  }

  async function bulkPublicSetStatus(
    ids: string[],
    status: "pending" | "approved" | "rejected",
  ) {
    if (!canEdit || !monthData) {
      setErr({ message: "Edit mode is not enabled." });
      return;
    }
    try {
      setErr(null);
      // simple: sequential (safe + easy)
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await patchPublicEntry({
          token,
          month: monthData.month.month,
          month_code: editCode,
          entry_id: id,
          status,
        });
      }
      await Promise.all([refreshDay(), refreshMonth()]);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
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

  useEffect(() => {
    setEditEnabled(false);
    setEditCode("");
    setEditErr("");
  }, [month]);

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
  const [services, setServices] = useState<CatLite[]>([]);
  const [departments, setDepartments] = useState<CatLite[]>([]);

  const approvedByDate = useMemo(() => {
    const all = monthData?.approved ?? [];
    const filtered = !deptFilterId
      ? all
      : all.filter((e) => e.department_category_id === deptFilterId);

    return groupApprovedByDate(filtered);
  }, [monthData, deptFilterId]);

  const { cells } = useMemo(() => buildMonthGridWithMuted(month), [month]);

  const pendingMap = useMemo(
    () => pendingCountsToMap(monthData?.pending_counts ?? []),
    [monthData],
  );

  const rawDraftOpen: unknown = monthData?.month.draft_open;
  const draftOpen = coerceBool(rawDraftOpen, false);

  const modalDate = modal.open ? modal.date : null;

  const modalApproved = useMemo(() => {
    if (!modalDate) return [];
    return approvedByDate[modalDate] ?? [];
  }, [approvedByDate, modalDate]);

  // Month edit mode (public)
  const [editCode, setEditCode] = useState<string>("");
  const [editEnabled, setEditEnabled] = useState<boolean>(false); // "edit mode" toggle after verify
  const [editOpen, setEditOpen] = useState<boolean>(false); // modal open/close
  const [editErr, setEditErr] = useState<string>(""); // error inside modal

  const editsOpen = coerceBool(monthData?.month?.edits_open, false);
  const canEdit = draftOpen && editsOpen && editEnabled;

  const [openPendingKeys, setOpenPendingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [openApprovedKeys, setOpenApprovedKeys] = useState<Set<string>>(
    new Set(),
  );

  const approvedList: PublicEntryLite[] = useMemo(() => {
    const fromDay = dayData?.approved ?? [];
    if (fromDay.length) return fromDay;

    // normalize month-approved into PublicEntryLite
    return modalApproved.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      notes: e.notes ?? null,
      service_category_id: e.service_category_id ?? null,
      department_category_id: e.department_category_id ?? null,
    }));
  }, [dayData?.approved, modalApproved]);

  const pendingList = dayData?.pending ?? [];
  const rejectedList = dayData?.rejected ?? [];

  const pendingListFiltered = useMemo(() => {
    if (!deptFilterId) return pendingList;
    return pendingList.filter((e) => e.department_category_id === deptFilterId);
  }, [pendingList, deptFilterId]);

  const rejectedListFiltered = useMemo(() => {
    if (!deptFilterId) return rejectedList;
    return rejectedList.filter(
      (e) => e.department_category_id === deptFilterId,
    );
  }, [rejectedList, deptFilterId]);

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
    setShowAddRow(false);
    setShowSignupRow(false);
  }

  const serviceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.name);
    return m;
  }, [services]);

  const deptNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) m.set(d.id, d.name);
    return m;
  }, [departments]);

  const pendingGroups = useMemo<PendingGroup[]>(() => {
    const map = new Map<string, PendingGroup>();

    for (const e of pendingListFiltered) {
      const sid = e.service_category_id ?? "";
      const did = e.department_category_id ?? "";
      const mapKey = `${sid}|${did}`;

      const serviceName = sid
        ? (serviceNameById.get(sid) ?? "Service")
        : "Service";
      const deptName = did
        ? (deptNameById.get(did) ?? "Department")
        : "Department";
      const header = `${serviceName} • ${deptName}`;

      const g =
        map.get(mapKey) ??
        (() => {
          const ng: PendingGroup = {
            key: header,
            service_category_id: e.service_category_id,
            department_category_id: e.department_category_id,
            rows: [],
          };
          map.set(mapKey, ng);
          return ng;
        })();

      g.rows.push(e);
    }

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [pendingListFiltered, serviceNameById, deptNameById]);

  const approvedGroups = useMemo(
    () => groupByServiceDeptPublic(approvedList, serviceNameById, deptNameById),
    [approvedList, serviceNameById, deptNameById],
  );

  const [pendingDeptMap, setPendingDeptMap] = useState<Record<string, number>>(
    {},
  );
  const [pendingDeptLoading, setPendingDeptLoading] = useState(false);

  useEffect(() => {
    const keys =
      pendingGroups.length <= 2
        ? pendingGroups.map((g) => g.key)
        : pendingGroups.slice(0, 2).map((g) => g.key);

    const next = new Set(keys);
    setOpenPendingKeys((prev) => (setsEqual(prev, next) ? prev : next));
  }, [modalDate, pendingGroups]);

  useEffect(() => {
    const keys =
      approvedGroups.length <= 2
        ? approvedGroups.map((g) => g.key)
        : approvedGroups.slice(0, 2).map((g) => g.key);

    const next = new Set(keys);
    setOpenApprovedKeys((prev) => (setsEqual(prev, next) ? prev : next));
  }, [modalDate, approvedGroups]);

  useEffect(() => {
    if (!deptFilterId && departments.length > 0) {
      setDeptFilterId(departments[0].id);
    }
  }, [departments, deptFilterId]);

  useEffect(() => {
    if (!modal.open || !monthData) return;

    (async () => {
      try {
        const res = await getPublicDay(
          token,
          monthData.month.month,
          modal.date,
        );
        setDayData(res);
      } catch (e) {
        // optional: show error in UI
        setDayData(null);
      }
    })();
  }, [modal.open, modalDate, monthData, token]);

  useEffect(() => {
    if (!canEdit) return;
    if (tab !== "pending") return;
    if (!monthData) return;
    if (!deptFilterId) {
      setPendingDeptMap({});
      return;
    }

    // immediate clear so old dept counts don't flash
    setPendingDeptMap({});

    let cancelled = false;

    (async () => {
      try {
        setPendingDeptLoading(true);

        const monthStr = monthData.month.month;
        const inMonthDates = cells.filter((c) => c.inMonth).map((c) => c.iso);

        const entries = await Promise.all(
          inMonthDates.map(async (date) => {
            const res = await getPublicDay(token, monthStr, date);
            const cnt = (res?.pending ?? []).filter(
              (e) => e.department_category_id === deptFilterId,
            ).length;
            return [date, cnt] as const;
          }),
        );

        if (cancelled) return;

        const next: Record<string, number> = {};
        for (const [date, cnt] of entries) next[date] = cnt;
        setPendingDeptMap(next);
      } finally {
        if (!cancelled) setPendingDeptLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canEdit, tab, monthData, deptFilterId, token, cells]);

  useEffect(() => {
    if (!canEdit && dayView === "pending") setDayView("approved");
  }, [canEdit, dayView]);

  const modalPendingCount = useMemo(() => {
    if (!modalDate) return 0;

    // when you're in pending tab (or you always want it dept-aware), prefer dept map
    if (deptFilterId && tab === "pending")
      return pendingDeptMap[modalDate] ?? 0;

    return pendingMap[modalDate] ?? 0;
  }, [modalDate, deptFilterId, tab, pendingDeptMap, pendingMap]);

  function closeModal() {
    setModal({ open: false });

    setShowAddRow(false);
    setShowSignupRow(false);

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
        month_code: canEdit ? editCode : null,
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

  async function verifyCode() {
    if (!monthData) return;
    setEditErr("");

    try {
      const res = await verifyPublicMonthCode(
        token,
        monthData.month.month,
        editCode,
      );
      if (!res.valid) {
        setEditEnabled(false);
        setEditErr("Invalid code.");
        return;
      }
      setEditEnabled(true);
      setEditOpen(false);
    } catch (e) {
      setEditEnabled(false);
      setEditErr(e instanceof Error ? e.message : "Error verifying code");
    }
  }

  const showApprovedInline = tab === "approved";
  const showPendingInline = canEdit && tab === "pending";

  const preview = (names: string[]) => names.slice(0, 3).join(", ");

  const logoKey = meta?.org.settings.logo_path ?? null;

  const logoUrl = useMemo(() => {
    if (!logoKey) return null;

    if (logoKey.startsWith("http://") || logoKey.startsWith("https://"))
      return logoKey;

    return supabase.storage.from("org-logos").getPublicUrl(logoKey).data
      .publicUrl;
  }, [logoKey]);

  return (
    <>
      {/* Top bar (matches admin layout) */}
      <div className="border-b">
        {/* ===================== Row 1: Header + Month nav + Signups status ===================== */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            {/* Left: Logo + Title + Subtitle */}
            <div className="flex items-center gap-3">
              {!useDefaultLogo && logoUrl ? (
                <div className="h-16 w-16 overflow-hidden rounded-xl bg-white flex items-center justify-center">
                  <Image
                    src={logoUrl}
                    alt={`${orgName} logo`}
                    width={100}
                    height={100}
                    className="object-contain"
                    priority
                  />
                </div>
              ) : (
                <div className="h-10 w-10 overflow-hidden rounded-xl border bg-white" />
              )}

              <div>
                <div className="text-xl font-semibold"> {orgName} </div>

                <div className="text-sm text-slate-600">
                  Workers Schedule | View approved assignments, and sign up for
                  open days.
                </div>
              </div>
            </div>

            {/* Right: Month nav + Signups status (2 cols) */}
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {/* Month nav */}
              <div className="inline-flex items-center rounded-2xl border bg-white p-1">
                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, -1))}
                  aria-label="Previous month"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl
              text-slate-600 hover:bg-slate-50
              focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
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
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 4.7a1 1 0 011.42 0l5 5a1 1 0 010 1.42l-5 5a1 1 0 11-1.42-1.42L11.09 10 7.21 6.12a1 1 0 010-1.42z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              {/* Signups status */}
              <div
                className={`inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2 ${
                  draftOpen ? "border-emerald-700" : "border-amber-700"
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
        </div>

        {/* ===================== Row 2: Tabs + Department + Edit mode ===================== */}
        <div className="px-6 pb-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            {/* Tabs (left) */}
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

              {canEdit ? (
                <button
                  type="button"
                  className={`rounded-2xl px-4 py-2 text-sm ${
                    tab === "pending"
                      ? "bg-white border shadow-sm"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  onClick={() => setTab("pending")}
                >
                  Signups
                </button>
              ) : null}
            </div>

            {/* Dept + Edit (right, 2 cols) */}
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {/* Department filter */}
              <div className="inline-flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-2">
                <div className="text-sm font-semibold text-slate-800">
                  Department
                </div>
                <select
                  className="rounded-xl border bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={deptFilterId}
                  onChange={(e) => setDeptFilterId(e.target.value)}
                >
                  {/* <option value="all">All</option> */}
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Edit mode button */}
              <button
                type="button"
                onClick={() => {
                  setEditErr("");
                  setEditOpen(true);
                }}
                disabled={!editsOpen}
                className={[
                  "inline-flex items-center justify-between gap-3 rounded-2xl border px-4 py-2 text-left transition",
                  !editsOpen
                    ? "opacity-60 cursor-not-allowed bg-white"
                    : "bg-white hover:bg-slate-50",
                  canEdit ? "border-emerald-200 bg-emerald-50" : "",
                ].join(" ")}
              >
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    Edit mode
                  </div>
                  <div className="text-xs text-slate-600">
                    {!editsOpen
                      ? "Admin has not enabled edits for this month"
                      : canEdit
                        ? "Enabled for this session"
                        : "Enter month code to enable"}
                  </div>
                </div>

                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    canEdit
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-700",
                  ].join(" ")}
                >
                  {canEdit ? "ON" : "OFF"}
                </span>
              </button>
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
            {canEdit && tab === "pending" && !draftOpen ? (
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
                      const approved = approvedByDate[c.iso] ?? [];
                      const approvedSummary = summarizeApprovedByService(
                        approved,
                        serviceNameById,
                        {
                          maxServices: 1,
                          maxNamesChars: 50,
                        },
                      );

                      const pendingCount =
                        tab === "pending" && deptFilterId
                          ? pendingDeptLoading
                            ? 0
                            : (pendingDeptMap[c.iso] ?? 0)
                          : (pendingMap[c.iso] ?? 0);

                      const approvedNames = approved
                        .map((e) => e.name)
                        .filter(Boolean);
                      const collapseApproved =
                        shouldCollapseNames(approvedNames);

                      const isLastCol = (idx + 1) % 7 === 0;
                      const isEmpty = !c.inMonth;

                      const isClickable =
                        !isEmpty &&
                        (tab === "approved" || (canEdit && tab === "pending"));

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
                                  approved.length > 0 ? (
                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs">
                                      <div className="flex items-center justify-between">
                                        <div className="font-semibold text-emerald-900">
                                          Approved
                                        </div>
                                        <div className="text-[11px] text-emerald-900/70">
                                          {approved.length}
                                        </div>
                                      </div>

                                      {approvedSummary.shown.length ? (
                                        <div className="mt-2 space-y-2">
                                          {approvedSummary.shown.map((s) => (
                                            <div
                                              key={`${c.iso}-a-${s.serviceLabel}`}
                                              className="min-w-0"
                                            >
                                              <div className="font-semibold text-slate-900 truncate">
                                                {s.serviceLabel}
                                              </div>
                                              <div className="text-slate-700 whitespace-normal leading-snug line-clamp-2">
                                                {s.namesPreview}
                                              </div>
                                            </div>
                                          ))}
                                          {approvedSummary.overflowServices ? (
                                            <div className="text-slate-600">
                                              +
                                              {approvedSummary.overflowServices}{" "}
                                              more{" "}
                                              {approvedSummary.overflowServices ===
                                              1
                                                ? "service"
                                                : "services"}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <div className="mt-2 text-slate-600">
                                          —
                                        </div>
                                      )}
                                    </div>
                                  ) : null
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

      {/* ===================== Public Day Modal (Admin-style UI, Public logic) ===================== */}
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
                {/* Context action: edit-mode = Add assignment, normal = Sign up */}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddRow((v) => !v);
                      setShowSignupRow(false);
                    }}
                    className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                  >
                    {showAddRow ? "Hide add" : "Add assignment"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSignupRow((v) => !v);
                      setShowAddRow(false);
                    }}
                    className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                    disabled={!draftOpen}
                    title={!draftOpen ? "Sign-ups are closed" : undefined}
                  >
                    {showSignupRow ? "Hide sign up" : "Sign up"}
                  </button>
                )}

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
                {/* Tabs row: only Approved/Pending; Pending hidden in edit mode */}
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
                      Approved ({approvedList.length})
                    </button>

                    {canEdit ? (
                      <button
                        type="button"
                        className={`rounded-2xl px-4 py-2 text-sm ${
                          dayView === "pending"
                            ? "bg-white border shadow-sm"
                            : "text-slate-600 hover:bg-white"
                        }`}
                        onClick={() => setDayView("pending")}
                        disabled={!draftOpen}
                        title={
                          !draftOpen
                            ? "Pending is unavailable when sign-ups are closed"
                            : undefined
                        }
                      >
                        Pending ({pendingListFiltered.length})
                      </button>
                    ) : null}
                  </div>

                  {!canEdit && modalPendingCount ? (
                    <div className="text-xs text-slate-500">
                      Pending:{" "}
                      <span className="font-semibold">{modalPendingCount}</span>
                    </div>
                  ) : null}
                </div>

                {/* Inline action card:
              - edit mode: "Add assignment" (submissions treated as approved)
              - normal mode: "Submit a signup" (pending)
          */}
                {canEdit ? (
                  showAddRow ? (
                    <div className="rounded-3xl border bg-white overflow-hidden">
                      <div className="border-b bg-slate-50 px-5 py-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">
                              Add assignment
                            </div>
                            <div className="text-xs text-slate-600">
                              Edit mode is enabled — additions are saved as
                              approved.
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setShowAddRow(false)}
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
                              Add
                            </button>
                          </div>
                        </div>
                      </div>

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
                          placeholder="e.g., Door 5, Camera 2, Drummer"
                          rows={3}
                        />
                      </div>
                    </div>
                  ) : null
                ) : showSignupRow ? (
                  <div className="rounded-3xl border bg-white overflow-hidden">
                    <div className="border-b bg-slate-50 px-5 py-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            Submit a signup
                          </div>
                          <div className="text-xs text-slate-600">
                            Your signup will be pending approval.
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowSignupRow(false)}
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
                              onChange={(e) =>
                                setSignupServiceId(e.target.value)
                              }
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
                            placeholder="e.g., Door 5, Camera 2, Drummer"
                            rows={3}
                          />

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
                ) : null}

                {/* ===================== Main panel ===================== */}
                {dayView === "approved" || !canEdit ? (
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
                  <div className="rounded-3xl border bg-white overflow-hidden">
                    <div className="border-b bg-slate-50 px-5 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            Pending signups
                          </div>
                          <div className="text-xs text-slate-600">
                            Approve or reject individual signups.
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={pendingListFiltered.length === 0}
                            onClick={() => {
                              if (
                                !confirm(
                                  `Approve all ${pendingListFiltered.length} pending signups?`,
                                )
                              )
                                return;
                              void bulkPublicSetStatus(
                                pendingListFiltered.map((e) => e.id),
                                "approved",
                              );
                            }}
                            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:bg-slate-300"
                          >
                            Approve all
                          </button>

                          <button
                            type="button"
                            disabled={pendingListFiltered.length === 0}
                            onClick={() => {
                              if (
                                !confirm(
                                  `Reject all ${pendingListFiltered.length} pending signups?`,
                                )
                              )
                                return;
                              void bulkPublicSetStatus(
                                pendingListFiltered.map((e) => e.id),
                                "rejected",
                              );
                            }}
                            className="rounded-xl bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-500 disabled:bg-slate-300"
                          >
                            Reject all
                          </button>
                        </div>
                      </div>
                    </div>

                    {pendingGroups.length === 0 ? (
                      <div className="p-6 text-sm text-slate-600">
                        No pending entries.
                      </div>
                    ) : (
                      <div className="divide-y">
                        {pendingGroups.map((g) => {
                          const isOpen = openPendingKeys.has(g.key);

                          return (
                            <details
                              key={g.key}
                              open={isOpen}
                              className="group"
                            >
                              <summary
                                className="cursor-pointer list-none px-5 py-4 bg-primary text-white hover:bg-primary/90"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setOpenPendingKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(g.key)) next.delete(g.key);
                                    else next.add(g.key);
                                    return next;
                                  });
                                }}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-white">
                                    {g.key}
                                  </div>
                                  <div className="text-xs text-white">
                                    {g.rows.length}{" "}
                                    {g.rows.length === 1 ? "signup" : "signups"}
                                  </div>
                                </div>
                              </summary>

                              {isOpen ? (
                                <div className="border-t bg-white">
                                  <div className="grid grid-cols-12 border-b bg-primary/10 px-5 py-3 text-xs font-semibold text-black/95">
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
                                        className="grid grid-cols-12 items-center px-5 py-3 text-sm bg-white hover:bg-slate-50/60"
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
                                            <span className="text-slate-400">
                                              —
                                            </span>
                                          )}
                                        </div>

                                        <div className="col-span-2 flex justify-end gap-2">
                                          <button
                                            type="button"
                                            className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                                            onClick={() =>
                                              setPublicEntryStatus(
                                                e.id,
                                                "approved",
                                              )
                                            }
                                          >
                                            Approve
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded-xl bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500"
                                            onClick={() =>
                                              setPublicEntryStatus(
                                                e.id,
                                                "rejected",
                                              )
                                            }
                                          >
                                            Reject
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ===================== Rejected (always below) ===================== */}
                {canEdit && rejectedListFiltered.length ? (
                  <div className="rounded-3xl border bg-slate-50 p-5">
                    <div className="text-xs font-semibold text-slate-600">
                      Rejected
                    </div>

                    <div className="mt-3 divide-y rounded-2xl border bg-white">
                      {rejectedListFiltered.map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="text-sm text-slate-800">
                            <span className="font-semibold">{e.name}</span>
                            <span className="ml-2 text-slate-500 text-xs">
                              {roleLabel(e.role)}
                            </span>
                          </div>

                          {canEdit ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-xl border px-3 py-1 text-xs font-semibold hover:bg-slate-50"
                                onClick={() =>
                                  setPublicEntryStatus(e.id, "pending")
                                }
                              >
                                Pending
                              </button>
                              <button
                                type="button"
                                className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                                onClick={() =>
                                  setPublicEntryStatus(e.id, "approved")
                                }
                              >
                                Approve
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Enable edit mode</div>
                <div className="mt-1 text-sm text-slate-600">
                  Enter the 6-digit month code to unlock editing.
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Month:{" "}
                  <span className="font-semibold">{fmtMonthTitle(month)}</span>
                </div>
              </div>

              <button
                onClick={() => setEditOpen(false)}
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {editErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editErr}
                </div>
              ) : null}

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Month code
                </div>
                <input
                  inputMode="numeric"
                  value={editCode}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "");
                    setEditCode(raw.slice(0, 6));
                  }}
                  className="w-full rounded-2xl border px-4 py-3 text-lg tracking-widest font-mono outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="000000"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {editEnabled ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditEnabled(false);
                      setEditCode("");
                      setEditErr("");
                      setEditOpen(false);
                    }}
                    className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  >
                    Turn off
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={editCode.length !== 6}
                  onClick={verifyCode}
                  className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85 disabled:bg-slate-300"
                >
                  Enable
                </button>
              </div>

              <div className="text-xs text-slate-500">
                When enabled, new signups are treated as approved (only while
                edits are allowed).
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
