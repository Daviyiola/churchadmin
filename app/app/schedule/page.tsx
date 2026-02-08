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
import { supabase } from "@/lib/supabaseClient";
import { QRCodeCanvas } from "qrcode.react";

type UiError = { message: string } | null;

type Entry = AdminMonthResponse["entries"][number];

type CategoryLite = { id: string; name: string };
type AddMode = "approved" | "pending";
type TabKey = "approved" | "draft";
type DayView = "approved" | "pending";

type DayModalState = { open: false } | { open: true; date: string };

type CalendarCell = { iso: string; day: number; inMonth: boolean };

type ServiceGroupSummary = {
  serviceLabel: string;
  total: number;
  namesPreview: string;
};

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

function isPostgresUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

function normalizeCategoryName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
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

function previewNames(names: string[], maxChars = 140) {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "—";

  let out = "";
  let used = 0;

  for (let i = 0; i < clean.length; i++) {
    const next = (i === 0 ? "" : ", ") + clean[i];
    if (used + next.length > maxChars) {
      return out.trim() + "…";
    }
    out += next;
    used += next.length;
  }

  return out;
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
 * Collapse rule:
 * - if >3 names OR too many total words -> show "Pending (N)" etc.
 */
function shouldCollapseNames(names: string[]) {
  if (names.length > 7) return true;
  const totalWords = names.reduce((acc, n) => acc + wordsLen(n), 0);
  return totalWords >= 100; // tweak
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
  const [showAddRow, setShowAddRow] = useState(false);

  // Remember last view inside the day modal (do NOT reset on open/close)
  const [dayView, setDayView] = useState<DayView>("approved");

  // Add form (in modal)
  const [addMode, setAddMode] = useState<AddMode>("approved");
  const [addName, setAddName] = useState<string>("");
  const [addRole, setAddRole] = useState<ScheduleRole>("member");
  const [addNotes, setAddNotes] = useState<string>("");

  // Service/Department pickers (typeahead + quick add)
  const [serviceCats, setServiceCats] = useState<CategoryLite[]>([]);
  const [deptCats, setDeptCats] = useState<CategoryLite[]>([]);
  const [catErr, setCatErr] = useState<string>("");

  const [deptId, setDeptId] = useState<string>("");
  const [deptQuery, setDeptQuery] = useState<string>("");
  const [deptOpen, setDeptOpen] = useState<boolean>(false);

  const [deptFilterId, setDeptFilterId] = useState<string>("all");
  const [autoApproveUi, setAutoApproveUi] = useState<boolean>(false);

  const [openPendingKeys, setOpenPendingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [openApprovedKeys, setOpenApprovedKeys] = useState<Set<string>>(
    new Set(),
  );

  const serviceIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of serviceCats) m.set(normalizeCategoryName(c.name), c.id);
    return m;
  }, [serviceCats]);

  // service picker used for the add-row header area
  const [serviceId, setServiceId] = useState<string>("");
  const [serviceQuery, setServiceQuery] = useState<string>("");
  const [serviceOpen, setServiceOpen] = useState(false);

  const deptIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of deptCats) m.set(normalizeCategoryName(c.name), c.id);
    return m;
  }, [deptCats]);

  const canAdd = addName.trim().length > 0 && !!serviceId;

  // Public link modal
  const [publicOpen, setPublicOpen] = useState(false);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string>("");
  const [publicErr, setPublicErr] = useState<string>("");

  // Toast
  const [toast, setToast] = useState<string>("");

  const [monthCode, setMonthCode] = useState<string>("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeErr, setCodeErr] = useState<string>("");

  const codeSetAt = data?.month?.month_code_set_at
    ? String(data.month.month_code_set_at)
    : "";

  const hasCodeSet = Boolean(codeSetAt);
  const rawEditsOpen: unknown = data?.month?.edits_open;
  const editsOpen = coerceBool(rawEditsOpen, false);

  async function generateMonthCode() {
    if (!orgId) return;
    setCodeErr("");
    setCodeLoading(true);
    try {
      const { data, error } = await supabase.rpc("schedule_set_month_code", {
        p_org_id: orgId,
        p_month: month,
      });

      if (error) throw new Error(error.message);

      const code = String(data ?? "").trim();
      if (!/^\d{6}$/.test(code)) throw new Error("Invalid code returned");
      setMonthCode(code);
    } catch (e) {
      setCodeErr(e instanceof Error ? e.message : "Failed to generate code");
    } finally {
      setCodeLoading(false);
    }
  }

  async function fetchServices(_orgId: string, _jwt: string) {
    const { data, error } = await supabase
      .from("categories")
      .select("id,name")
      .eq("org_id", _orgId)
      .eq("status", "active")
      .eq("type", "services")
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
    }));
  }

  async function fetchDepartments(_orgId: string, _jwt: string) {
    const { data, error } = await supabase
      .from("categories")
      .select("id,name")
      .eq("org_id", _orgId)
      .eq("status", "active")
      .eq("type", "department")
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
    }));
  }

  async function bulkSetStatus(entryIds: string[], status: ScheduleStatus) {
    if (!orgId || !jwt) return;

    try {
      await Promise.allSettled(
        entryIds.map((id) =>
          patchAdminEntry({ org_id: orgId, entry_id: id, status }, jwt),
        ),
      );
      await refresh(month);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : "Error" });
    }
  }

  type ServiceGroupSummary = {
    serviceLabel: string;
    total: number;
    namesPreview: string;
  };

  function summarizeByService(
    items: Entry[],
    status: ScheduleStatus,
    serviceNameById: Map<string, string>,
    opts?: {
      maxServices?: number; // how many service groups to show in the cell
      maxNamesChars?: number; // max chars for names preview per service
      sort?: "count" | "alpha"; // how to order services in the cell
    },
  ): { shown: ServiceGroupSummary[]; overflowServices: number } {
    const maxServices = opts?.maxServices ?? 2;
    const maxNamesChars = opts?.maxNamesChars ?? 80;
    const sort = opts?.sort ?? "count";

    const filtered = items.filter((e) => e.status === status);

    // group by service id
    const g = new Map<string, Entry[]>();
    for (const e of filtered) {
      const sid = String(e.service_category_id ?? "");
      const key = sid || "__none__";
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(e);
    }

    const groups = Array.from(g.entries()).map(([sid, rows]) => {
      const label = sid === "__none__" ? "—" : serviceNameById.get(sid) || "—";

      const names = rows.map((r) => r.name).filter(Boolean);
      const namesPreview = shouldCollapseNames(names)
        ? `${rows.length} people`
        : previewNames(names, maxNamesChars);

      return {
        serviceLabel: label,
        total: rows.length,
        namesPreview,
      } satisfies ServiceGroupSummary;
    });

    groups.sort((a, b) => {
      if (sort === "alpha") return a.serviceLabel.localeCompare(b.serviceLabel);
      // default: biggest first, then alpha
      if (b.total !== a.total) return b.total - a.total;
      return a.serviceLabel.localeCompare(b.serviceLabel);
    });

    const shown = groups.slice(0, maxServices);
    const overflowServices = Math.max(0, groups.length - shown.length);

    return { shown, overflowServices };
  }

  function applyDeptFilter(list: Entry[]) {
    if (deptFilterId === "all") return list;
    return list.filter(
      (e) => String(e.department_category_id ?? "") === deptFilterId,
    );
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2000);
  }

  async function ensurePublicUrl() {
    if (publicUrl) return publicUrl;
    if (!orgId || !jwt) throw new Error("Missing orgId or auth");

    setPublicLoading(true);
    setPublicErr("");

    try {
      const res = await fetch(
        `/api/schedule/admin/public-link?org_id=${encodeURIComponent(orgId)}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      if (!res.ok) throw new Error("Request failed");
      const json: PublicLinkResponse = (await res.json()) as PublicLinkResponse;
      if (!json.publicUrl) throw new Error("Missing publicUrl");

      setPublicUrl(json.publicUrl);
      return json.publicUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load public link";
      setPublicErr(msg);
      throw new Error(msg);
    } finally {
      setPublicLoading(false);
    }
  }

  async function openPublicLinkModal() {
    setPublicOpen(true);
    try {
      await ensurePublicUrl();
    } catch {
      // error state already set
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      setErr({ message: "Copy failed." });
    }
  }

  function downloadQrPng(filename = "schedule-public-link-qr.png") {
    // QRCodeCanvas renders a <canvas>. We can grab it and export PNG.
    const canvas = document.getElementById(
      "public-link-qr",
    ) as HTMLCanvasElement | null;

    if (!canvas) return;

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  useEffect(() => {
    if (!modal.open) return;

    const scrollY = window.scrollY;

    // Freeze the page visually
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";

    return () => {
      // Unfreeze and restore scroll position
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

  async function quickAddCategory(
    kind: "services" | "department",
    name: string,
  ): Promise<CategoryLite> {
    if (!orgId) throw new Error("Missing orgId");

    const cleanName = name.trim();
    if (!cleanName) throw new Error("Name is required.");

    const { data: sessionRes } = await supabase.auth.getSession();
    const userId = sessionRes.session?.user?.id;
    if (!userId) throw new Error("You must be signed in.");

    // Soft pre-check (avoid dupes + return existing)
    const { data: exists, error: existsErr } = await supabase
      .from("categories")
      .select("id,name")
      .eq("org_id", orgId)
      .eq("type", kind)
      .ilike("name", cleanName)
      .maybeSingle();

    if (existsErr) throw new Error(existsErr.message);

    if (exists?.id) {
      return { id: String(exists.id), name: String(exists.name ?? cleanName) };
    }

    const { data: inserted, error } = await supabase
      .from("categories")
      .insert({
        org_id: orgId,
        name: cleanName,
        type: kind,
        status: "active",
        created_by: userId,
      })
      .select("id,name")
      .maybeSingle();

    if (error) {
      if (isPostgresUniqueViolation(error)) {
        throw new Error(`A ${kind} named "${cleanName}" already exists.`);
      }
      throw new Error(error.message);
    }

    if (!inserted?.id) throw new Error("Insert failed.");

    return {
      id: String(inserted.id),
      name: String(inserted.name ?? cleanName),
    };
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
  }, [orgId, jwt]);

  useEffect(() => {
    if (!orgId || !jwt) return;
    void refresh(month);
  }, [orgId, jwt, month]);

  const entries = data?.entries ?? [];
  const byDate = useMemo(() => groupByDate(entries), [entries]);
  const { cells } = useMemo(() => buildMonthGridWithMuted(month), [month]);

  const rawDraftOpen: unknown = data?.month?.draft_open;
  const draftOpen = coerceBool(rawDraftOpen, true);

  const modalDate = modal.open ? modal.date : null;

  const modalEntries = useMemo(() => {
    if (!modalDate) return [];
    const all = byDate[modalDate] ?? [];
    return applyDeptFilter(all);
  }, [modalDate, byDate, deptFilterId]);

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
  }

  function closeModal() {
    setModal({ open: false });

    setShowAddRow(false);

    setAddMode("approved");
    setAddName("");
    setAddNotes("");
    setAddRole("member");

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
        const created = await quickAddCategory("services", serviceQuery.trim());
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
          status: "approved",
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

  function setsEqual(a: Set<string>, b: Set<string>) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

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

  // ---------- render ----------
  return (
    <>
      {/* Top bar */}
      {/* Top bar */}
      <div className="border-b">
        <div className="px-6 py-4 mt-6">
          {/* ROW A: Title/subtitle (left) + Month nav/public link (right) */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            {/* Left: title + subheading */}
            <div>
              <div className="text-xl font-semibold">Workers Schedule</div>
              <div className="text-sm text-slate-600">
                Click any day to review signups, approve/reject, or add
                assignments.
              </div>
            </div>

            {/* Right: month nav + view public link */}
            <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
              <button
                type="button"
                onClick={openPublicLinkModal}
                className="rounded-2xl border bg-white px-4 py-2 text-sm hover:bg-slate-50"
              >
                View public link
              </button>

              <div className="inline-flex items-center rounded-2xl border bg-white p-1">
                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, -1))}
                  aria-label="Previous month"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30"
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
                  onClick={() => setMonth(monthFromDate(new Date()))}
                  className="mx-1 rounded-xl px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30"
                  title="Jump to current month"
                >
                  {fmtMonthTitle(month)}
                </button>

                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, 1))}
                  aria-label="Next month"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30"
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
            </div>
          </div>

          {/* ROW B: Tabs (left) + dept/toggles (right) */}
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Left: tabs */}
            <div className="inline-flex rounded-2xl border bg-slate-50 p-1 w-fit">
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

            {/* Right: department filter + toggles */}
            <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
              <div className="inline-flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
                <div className="text-sm font-semibold text-slate-800">
                  Department
                </div>
                <select
                  className="rounded-xl border bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={deptFilterId}
                  onChange={(e) => setDeptFilterId(e.target.value)}
                >
                  <option value="all">All</option>
                  {deptCats.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2">
                <div className="text-sm font-semibold text-slate-800">
                  Allow Edits
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!orgId || !jwt) return;
                    try {
                      await patchAdminMonthSettings(
                        { org_id: orgId, month, edits_open: !editsOpen },
                        jwt,
                      );
                      await refresh(month);
                    } catch (e) {
                      setErr({
                        message: e instanceof Error ? e.message : "Error",
                      });
                    }
                  }}
                  title={editsOpen ? "Allow edits: On" : "Allow edits: Off"}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition
    ${editsOpen ? "bg-emerald-500" : "bg-slate-300"}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition
      ${editsOpen ? "translate-x-5" : "translate-x-1"}`}
                  />
                </button>
              </div>

              <div className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2">
                <div className="text-sm font-semibold text-slate-800">
                  Allow signups
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

          {/* Errors */}
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
                    const dayEntries = applyDeptFilter(byDate[c.iso] ?? []);

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

                    const approvedSummary = summarizeByService(
                      dayEntries,
                      "approved",
                      serviceNameById,
                      { maxServices: 1, maxNamesChars: 50, sort: "count" },
                    );

                    const pendingSummary = summarizeByService(
                      dayEntries,
                      "pending",
                      serviceNameById,
                      { maxServices: 1, maxNamesChars: 50, sort: "count" },
                    );

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
                          "aspect-square min-h-[120px] border-t p-3 text-left transition flex flex-col",
                          isLastCol ? "" : "border-r",

                          isEmpty
                            ? "bg-slate-50/40 border-slate-100 text-slate-300 cursor-default pointer-events-none select-none"
                            : "bg-white hover:bg-slate-50 cursor-pointer",

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
                            <div className="flex items-start justify-between">
                              {/* Date – top left */}
                              <div className="inline-flex min-w-[26px] items-center justify-center rounded-md border bg-white px-2 py-1 text-xs font-semibold text-slate-800">
                                {c.day}
                              </div>

                              {/* Counts – top right */}
                              <div className="flex items-center gap-1">
                                {pending.length > 0 ? (
                                  <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-700">
                                    P:{pending.length}
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
                              {showApprovedInline && approved.length > 0 ? (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs">
                                  <div className="flex items-center justify-between">
                                    <div className="font-semibold text-emerald-900">
                                      Approved
                                    </div>
                                    <div className="text-[11px] text-emerald-900/70">
                                      {approved.length || 0}
                                    </div>
                                  </div>

                                  {approvedSummary.shown.length ? (
                                    <div className="mt-2 space-y-2">
                                      {approvedSummary.shown.map((s) => (
                                        <div
                                          key={`a-${c.iso}-${s.serviceLabel}`}
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
                                          +{approvedSummary.overflowServices}{" "}
                                          more{" "}
                                          {approvedSummary.overflowServices ===
                                          1
                                            ? "service"
                                            : "services"}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <div className="mt-2 text-slate-600">—</div>
                                  )}
                                </div>
                              ) : null}

                              {showPendingInline && pending.length > 0 ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs">
                                  <div className="flex items-center justify-between">
                                    <div className="font-semibold text-amber-900">
                                      Pending
                                    </div>
                                    <div className="text-[11px] text-amber-900/70">
                                      {pending.length || 0}
                                    </div>
                                  </div>

                                  {pendingSummary.shown.length ? (
                                    <div className="mt-2 space-y-2">
                                      {pendingSummary.shown.map((s) => (
                                        <div
                                          key={`p-${c.iso}-${s.serviceLabel}`}
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

                                      {pendingSummary.overflowServices ? (
                                        <div className="text-slate-600">
                                          +{pendingSummary.overflowServices}{" "}
                                          more{" "}
                                          {pendingSummary.overflowServices === 1
                                            ? "service"
                                            : "services"}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <div className="mt-2 text-slate-600">—</div>
                                  )}
                                </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          // onClick={closeModal}
        >
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
                  onClick={() => setShowAddRow((v) => !v)}
                  className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                >
                  {showAddRow ? "Hide add" : "Add assignment"}
                </button>

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
                </div>

                {/* Inline Add Row (replaces the big "Add new" card) */}
                {showAddRow ? (
                  <div className="rounded-3xl border bg-white overflow-visible">
                    {/* Header */}
                    <div className="border-b bg-slate-50 px-5 py-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            Add assignment
                          </div>
                          <div className="text-xs text-slate-600">
                            Admin additions are saved as approved.
                          </div>
                        </div>

                        {/* Right controls: Service + Cancel/Add */}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                          {/* Service picker (moved up here) */}
                          <div className="relative sm:w-[260px]">
                            <input
                              className="w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                              value={serviceQuery}
                              onFocus={() => setServiceOpen(true)}
                              onBlur={() =>
                                window.setTimeout(
                                  () => setServiceOpen(false),
                                  120,
                                )
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setServiceQuery(v);
                                const id = serviceIdByLabel.get(
                                  normalizeCategoryName(v),
                                );
                                setServiceId(id ?? "");
                                setServiceOpen(true);
                              }}
                              placeholder="Service"
                            />

                            {serviceOpen ? (
                              <div className="absolute z-[80] mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg max-h-56 overflow-auto">
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
                                          const created =
                                            await quickAddCategory(
                                              "services",
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
                              onClick={addEntry}
                              disabled={!canAdd}
                              className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${
                                canAdd
                                  ? "bg-primary hover:bg-primary/85"
                                  : "bg-slate-300"
                              }`}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-x-3 border-b bg-primary px-5 py-3 text-xs font-semibold text-slate-100">
                      <div className="col-span-3">Name *</div>
                      <div className="col-span-3">Department</div>
                      <div className="col-span-2">Role</div>
                      <div className="col-span-4">Notes</div>
                    </div>

                    {/* Input row */}
                    <div className="grid grid-cols-12 gap-x-3 px-5 py-4">
                      {/* Name */}
                      <div className="col-span-3 pr-3 min-w-0">
                        <input
                          className="block w-full min-w-0 rounded-2xl  px-3 py-2 text-sm
                 outline-none focus:ring-2 focus:ring-primary/30"
                          value={addName}
                          onChange={(e) => setAddName(e.target.value)}
                          placeholder="e.g., John A."
                        />
                      </div>

                      {/* Department */}
                      <div className="col-span-3 relative pr-3 min-w-0">
                        <input
                          className="block w-full min-w-0 rounded-2xl  px-3 py-2 text-sm
                 outline-none focus:ring-2 focus:ring-primary/30"
                          value={deptQuery}
                          onFocus={() => setDeptOpen(true)}
                          onBlur={() =>
                            window.setTimeout(() => setDeptOpen(false), 120)
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setDeptQuery(v);
                            const id = deptIdByLabel.get(
                              normalizeCategoryName(v),
                            );
                            setDeptId(id ?? "");
                            setDeptOpen(true);
                          }}
                          placeholder="eg. Choir"
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

                      {/* Role */}
                      <div className="col-span-2 pr-3 min-w-0">
                        <select
                          className="block w-full min-w-0 rounded-2xl  px-3 py-2 text-sm
                 outline-none focus:ring-2 focus:ring-primary/30"
                          value={addRole}
                          onChange={(e) =>
                            setAddRole(e.target.value as ScheduleRole)
                          }
                        >
                          <option value="lead">Lead</option>
                          <option value="asst">Asst</option>
                          <option value="member">Member</option>
                        </select>
                      </div>

                      {/* Notes */}
                      <div className="col-span-4 min-w-0">
                        <input
                          className="block w-full min-w-0 rounded-2xl  px-3 py-2 text-sm
                 outline-none focus:ring-2 focus:ring-primary/30"
                          value={addNotes}
                          onChange={(e) => setAddNotes(e.target.value)}
                          placeholder="Notes (optional)"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Pending / Approved lists */}
                {dayView === "pending" ? (
                  <div className="rounded-3xl border bg-white overflow-hidden">
                    <div className="border-b bg-slate-50 px-5 py-3">
                      <div className="flex items-center justify-between gap-4">
                        {/* Left: header + subheader */}
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            Pending signups
                          </div>
                          <div className="text-xs text-slate-600">
                            Approve or reject individual signups.
                          </div>
                        </div>

                        {/* Right: actions */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={modalPending.length === 0}
                            onClick={() => {
                              if (
                                !confirm(
                                  `Approve all ${modalPending.length} pending signups?`,
                                )
                              )
                                return;
                              void bulkSetStatus(
                                modalPending.map((e) => e.id),
                                "approved",
                              );
                            }}
                            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:bg-slate-300"
                          >
                            Approve all
                          </button>

                          <button
                            type="button"
                            disabled={modalPending.length === 0}
                            onClick={() => {
                              if (
                                !confirm(
                                  `Reject all ${modalPending.length} pending signups?`,
                                )
                              )
                                return;
                              void bulkSetStatus(
                                modalPending.map((e) => e.id),
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
                                  e.preventDefault(); // stop native toggle
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
                                              setEntryStatus(e.id, "approved")
                                            }
                                          >
                                            Approve
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded-xl bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500"
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
                              ) : null}
                            </details>
                          );
                        })}
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
                        {approvedGroups.map((g) => {
                          const isOpen = openApprovedKeys.has(g.key);

                          return (
                            <details
                              key={g.key}
                              open={isOpen}
                              className="group"
                            >
                              <summary
                                className="cursor-pointer list-none px-5 py-4 bg-primary text-white hover:bg-primary/90"
                                onClick={(e) => {
                                  e.preventDefault(); // stop native toggle
                                  setOpenApprovedKeys((prev) => {
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
                                    {g.rows.length === 1
                                      ? "assignment"
                                      : "assignments"}
                                  </div>
                                </div>
                              </summary>
                              {isOpen ? (
                                <div className="border-t bg-white">
                                  <div className="grid grid-cols-12 border-b bg-primary/15 px-5 py-3 text-xs font-semibold text-black">
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

                                        <div className="col-span-2 flex justify-end">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (!confirm(`Reject ${e.name}?`))
                                                return;
                                              setEntryStatus(e.id, "rejected");
                                            }}
                                            className="rounded-xl bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500"
                                            title="Reject assignment"
                                          >
                                            Remove
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

                {/* Rejected */}
                {modalRejected.length ? (
                  <div className="rounded-3xl border bg-slate-50 p-5">
                    <div className="text-xs font-semibold text-slate-600">
                      Rejected
                    </div>

                    <div className="mt-3 divide-y rounded-2xl border bg-white">
                      {modalRejected.map((e) => (
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

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="rounded-xl border px-3 py-1 text-xs font-semibold hover:bg-slate-50"
                              onClick={() => setEntryStatus(e.id, "pending")}
                            >
                              Pending
                            </button>
                            <button
                              type="button"
                              className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                              onClick={() => setEntryStatus(e.id, "approved")}
                            >
                              Approve
                            </button>
                          </div>
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

      {toast ? (
        <div className="fixed right-4 top-4 z-[100]">
          <div className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}

      {publicOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPublicOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] rounded-3xl bg-white shadow-xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold">
                    Public schedule link
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Share this link or let people scan the QR code to sign up.
                  </div>
                </div>

                <button
                  onClick={() => setPublicOpen(false)}
                  className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="px-6 py-5 space-y-4">
                <div className="mt-5 space-y-4">
                  {publicErr ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {publicErr}
                    </div>
                  ) : null}

                  <div className="rounded-2xl border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">QR code</div>

                      <button
                        type="button"
                        disabled={!publicUrl}
                        onClick={() => downloadQrPng()}
                        className="rounded-2xl border px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                      >
                        Download
                      </button>
                    </div>

                    <div className="flex justify-center">
                      <div className="rounded-3xl border bg-slate-50 p-5">
                        {publicLoading && !publicUrl ? (
                          <div className="h-[280px] w-[280px] grid place-items-center text-sm text-slate-600">
                            Loading…
                          </div>
                        ) : publicUrl ? (
                          <QRCodeCanvas
                            id="public-link-qr"
                            value={publicUrl}
                            size={280}
                            includeMargin
                          />
                        ) : (
                          <div className="h-[280px] w-[280px] grid place-items-center text-sm text-slate-600">
                            No link yet.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={publicUrl}
                        className="flex-1 rounded-2xl border px-3 py-2 text-sm"
                        placeholder={publicLoading ? "Loading…" : ""}
                      />

                      <button
                        type="button"
                        disabled={!publicUrl}
                        onClick={() => copyToClipboard(publicUrl)}
                        className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                      >
                        Copy
                      </button>
                    </div>

                    <div className="text-xs text-slate-500 text-center">
                      People can scan this QR code to open the public schedule.
                    </div>
                  </div>

                  {/* ✅ Monthly code block goes here */}
                  <div className="rounded-2xl border p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          Monthly code
                        </div>
                        <div className="text-xs text-slate-600">
                          Share this with department heads. With the code, they
                          can approve/edit for this month when “Allow edits” is
                          enabled.
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={generateMonthCode}
                        disabled={!orgId || codeLoading}
                        className="rounded-2xl border px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                      >
                        {codeLoading
                          ? "Generating…"
                          : monthCode || hasCodeSet
                            ? "Rotate"
                            : "Generate"}
                      </button>
                    </div>

                    {codeErr ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {codeErr}
                      </div>
                    ) : null}

                    {monthCode ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-2xl border bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold text-slate-600">
                            Code (valid for {fmtMonthTitle(month)})
                          </div>
                          <div className="mt-1 font-mono text-2xl tracking-widest text-slate-900">
                            {monthCode}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(monthCode)}
                          className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                        >
                          Copy
                        </button>
                      </div>
                    ) : hasCodeSet ? (
                      <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-800">
                          Code is already set
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          For security, the code is only shown when generated.
                          Use “Rotate” to generate a new one.
                        </div>

                        {codeSetAt ? (
                          <div className="mt-2 text-xs text-slate-500">
                            Last rotated: {new Date(codeSetAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-600">
                        No code generated yet.
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    {/* Open link button etc */}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={!publicUrl}
                      onClick={() => {
                        if (!publicUrl) return;
                        window.open(publicUrl, "_blank", "noopener,noreferrer");
                      }}
                      className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85 disabled:bg-slate-300"
                    >
                      Open link
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
