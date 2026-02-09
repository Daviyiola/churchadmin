"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { QRCodeCanvas } from "qrcode.react";

/* ===================== Types ===================== */

type ShowFilter = "all" | "new" | "joined" | "due";

type Gender = "male" | "female";
type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";
type Segment = "men" | "women" | "boys" | "girls";

type OrgRole = "owner" | "admin" | "finance" | "member";

type MenuState = { id: string; top: number; right: number } | null;

type VisitorRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "archived";
  created_at: string;

  gender: Gender | null;
  age_group: AgeGroup | null;
  segment: Segment | null;
  address: string | null;
  marital_status: string | null;
  children_count: number | null;

  membership_stage:
    | "visitor"
    | "regular_attender"
    | "member"
    | "stopped_attending";
  profile_complete: boolean;

  visitor_details?: {
    first_visit_at: string | null;
    follow_up_status:
      | "new"
      | "contacted"
      | "scheduled"
      | "visited_again"
      | "joined"
      | null;
    next_follow_up_at: string | null;
    follow_up_notes: string | null;
    how_heard: string | null;
    prayer_request_tags: string[] | null;
  } | null;
};

type PrayerItem = { id: string; text: string };

type CampaignRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  url: string; // computed client-side
};

type CampaignRowDb = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
};

type PendingSendAction = "followup"; // (only needed here)
type PlanKey = "free" | "basic" | "growth" | "enterprise";

type LimitsPayload = {
  ok: true;
  plan: PlanKey;
  month_bucket: string;
  month_limit: number;
  month_used: number;
  month_left: number;
};

function isLimitsPayload(v: unknown): v is LimitsPayload {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.ok === true &&
    (o.plan === "free" ||
      o.plan === "basic" ||
      o.plan === "growth" ||
      o.plan === "enterprise") &&
    typeof o.month_left === "number" &&
    typeof o.month_used === "number" &&
    typeof o.month_limit === "number" &&
    typeof o.month_bucket === "string"
  );
}

/* ===================== Helpers ===================== */

function isGender(v: string): v is Gender {
  return v === "male" || v === "female";
}
function isAgeGroup(v: string): v is AgeGroup {
  return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
}
function computeSegment(g: Gender, ag: AgeGroup): Segment {
  const under18 = ag === "1-12" || ag === "13-17";
  if (under18) return g === "male" ? "boys" : "girls";
  return g === "male" ? "men" : "women";
}
function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(baseISODate: string, days: number) {
  const d = new Date(`${baseISODate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isDue(nextISODate: string | null, joined: boolean) {
  if (joined) return false;
  if (!nextISODate) return false;
  return nextISODate <= todayISODate();
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}
function toPrayerItems(tags: string[] | null | undefined): PrayerItem[] {
  const clean = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  return clean.length
    ? clean.map((t) => ({ id: makeId(), text: t }))
    : [{ id: makeId(), text: "Family" }];
}
function fromPrayerItems(items: PrayerItem[]): string[] | null {
  const clean = items.map((x) => x.text.trim()).filter(Boolean);
  return clean.length ? clean : null;
}

function isVisitorRowArray(v: unknown): v is VisitorRow[] {
  return (
    Array.isArray(v) &&
    (v.length === 0 ||
      (typeof v[0] === "object" &&
        v[0] !== null &&
        "id" in v[0] &&
        "first_name" in v[0] &&
        "membership_stage" in v[0]))
  );
}

async function canEditPeopleForActiveOrg(orgId: string): Promise<boolean> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user?.id;
  if (!userId) return false;

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;

  const role = data?.role as OrgRole | undefined;
  return role === "owner" || role === "admin" || role === "finance";
}

function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/* ===================== Page ===================== */

export default function FirstTimersPage() {
  const orgId = getActiveOrgId();

  // ===== List page state =====
  const [q, setQ] = useState("");
  const [show, setShow] = useState<ShowFilter>("new");

  const [rows, setRows] = useState<VisitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [tab, setTab] = useState<"active" | "archived">("active");

  // ===== Toast =====
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("Copied to clipboard");
  function showToast(msg: string) {
    setToastText(msg);
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
  }
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed");
    }
  }

  // ===== Top dropdown =====
  const [genMenuOpen, setGenMenuOpen] = useState(false);

  // ===== Campaigns (multiple visitors) =====
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  const activeCampaignCount = campaigns.filter((c) => c.is_active).length;
  const campaignLimitReached = activeCampaignCount >= 2;

  // ===== View link modal =====
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkShowQr, setLinkShowQr] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmErr, setConfirmErr] = useState("");
  const [confirmAction, setConfirmAction] = useState<PendingSendAction | null>(
    null,
  );
  const [confirmCount, setConfirmCount] = useState(0);
  const [confirmPlan, setConfirmPlan] = useState<PlanKey>("basic");
  const [confirmLeftBefore, setConfirmLeftBefore] = useState(0);
  const [insufficient, setInsufficient] = useState(false);

  function openLinkModal(opts: {
    title: string;
    url: string;
    showQr?: boolean;
  }) {
    setLinkTitle(opts.title);
    setLinkUrl(opts.url);
    setLinkShowQr(Boolean(opts.showQr));
    setLinkOpen(true);
  }

  // ===== Modal A: Add/Edit First-Timer (full form) =====
  const [addOpen, setAddOpen] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addErr, setAddErr] = useState("");

  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editId, setEditId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [gender, setGender] = useState<Gender | "">("");
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "">("");

  const [address, setAddress] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [childrenCount, setChildrenCount] = useState<string>("");

  const [firstVisitAt, setFirstVisitAt] = useState<string>(todayISODate());
  const [howHeard, setHowHeard] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");

  const [nextFollowUpAt, setNextFollowUpAt] = useState(
    addDaysISO(todayISODate(), 3),
  );
  const [nextFollowUpTouched, setNextFollowUpTouched] = useState(false);
  const [orgName, setOrgName] = useState<string>("Our Church");

  const [prayerItems, setPrayerItems] = useState<PrayerItem[]>(
    toPrayerItems(["Family"]),
  );

  // ===== Modal B: Email Intake Form (minimal) =====
  const [emailOpen, setEmailOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailErr, setEmailErr] = useState("");

  const [emailFirstName, setEmailFirstName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [intakeUrl, setIntakeUrl] = useState("");

  // ===== Modal D: Create campaign link (QR code) =====
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("Sunday Service");
  const [campaignDays, setCampaignDays] = useState("3");
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignErr, setCampaignErr] = useState("");
  const [campaignUrl, setCampaignUrl] = useState("");

  // ===== Small modal: quick note + next follow up =====
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMemberId, setNoteMemberId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteNextDate, setNoteNextDate] = useState("");

  // ===== Modal C: Follow-up Email =====
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpSending, setFollowUpSending] = useState(false);
  const [followUpErr, setFollowUpErr] = useState("");
  const [followUpMember, setFollowUpMember] = useState<{
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    existing_notes: string | null;
  } | null>(null);

  const [followUpTo, setFollowUpTo] = useState("");
  const [followUpReplyTo, setFollowUpReplyTo] = useState("");
  const [followUpSubject, setFollowUpSubject] = useState(
    "Welcome! Thanks for visiting",
  );
  const [followUpBody, setFollowUpBody] = useState(
    "Hi {firstName},\n\nIt was great having you with us this Sunday. We’d love to stay connected. Feel free to reply to this email if you have any questions or prayer requests.\n\nBlessings,\n{churchName}",
  );

  // NEW: used to auto-download when user clicks “Download” in table
  const [autoDownload, setAutoDownload] = useState(false);

  // NEW: ref to find the QR canvas reliably (no ref forwarding needed)
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  function downloadQrPng(filenameBase: string) {
    const wrap = qrWrapRef.current;
    const canvas = wrap?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      showToast("QR not ready");
      return;
    }

    try {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(filenameBase || "qr").replace(/[^\w\-]+/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("QR downloaded");
    } catch {
      showToast("Download failed");
    }
  }

  async function fetchMonthlyLimits(
    orgId: string,
    jwt: string,
  ): Promise<LimitsPayload> {
    const res = await fetch(
      `/api/communications/limits?organization_id=${encodeURIComponent(orgId)}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Invalid limits response");
    }

    if (!res.ok) {
      const msg =
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : text || "Failed to load limits";
      throw new Error(msg);
    }

    if (!isLimitsPayload(parsed)) throw new Error("Bad limits response");
    return parsed;
  }

  async function requestSend(action: PendingSendAction, count: number) {
    setConfirmErr("");
    setConfirmLoading(true);
    setConfirmOpen(true);
    setInsufficient(false);

    try {
      if (!orgId) throw new Error("Missing org");

      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const limits = await fetchMonthlyLimits(orgId, jwt);

      setConfirmAction(action);
      setConfirmCount(count);
      setConfirmPlan(limits.plan);
      setConfirmLeftBefore(limits.month_left);

      if (limits.month_left < count) setInsufficient(true);
    } catch (e) {
      setConfirmErr(e instanceof Error ? e.message : "Failed to check limits");
    } finally {
      setConfirmLoading(false);
    }
  }

  async function proceedSend() {
    if (insufficient) return;
    if (!confirmAction) return;

    setConfirmOpen(false);

    if (confirmAction === "followup") {
      await sendFollowUpEmailInternal();
    }
  }

  // ===== More actions menu (per row) =====
  const [menu, setMenu] = useState<MenuState>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const openMenuIdRef = useRef<string | null>(null);

  useEffect(() => {
    openMenuIdRef.current = menu?.id ?? null;
  }, [menu]);

  useEffect(() => {
    setShow("new");
  }, [tab]);

  // NEW: if user clicked “Download” from table, auto-download after modal renders
  useEffect(() => {
    if (!linkOpen || !linkShowQr || !autoDownload) return;

    const t = window.setTimeout(() => {
      downloadQrPng(linkTitle || "campaign");
      setAutoDownload(false);
    }, 60);

    return () => window.clearTimeout(t);
  }, [linkOpen, linkShowQr, autoDownload, linkTitle]);

  // Close "More actions" menu when clicking outside table
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const openId = openMenuIdRef.current;
      if (!openId) return;
      const root = tableWrapRef.current;
      if (!root) {
        setMenu(null);
        return;
      }
      if (!root.contains(e.target as Node)) setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Close Generate dropdown on outside click
  useEffect(() => {
    const onPointerDown = () => setGenMenuOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const resetAddForm = () => {
    setMode("create");
    setEditId(null);

    setAddErr("");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");

    setGender("");
    setAgeGroup("");

    setAddress("");
    setMaritalStatus("");
    setChildrenCount("");

    const today = todayISODate();
    setFirstVisitAt(today);
    setHowHeard("");
    setFollowUpNotes("");

    setNextFollowUpAt(addDaysISO(today, 3));
    setNextFollowUpTouched(false);

    setPrayerItems(toPrayerItems(["Family"]));
  };

  const openCreate = () => {
    resetAddForm();
    setAddOpen(true);
    setErr("");
  };

  const openEdit = (r: VisitorRow) => {
    resetAddForm();
    setMode("edit");
    setEditId(r.id);

    setFirstName(r.first_name ?? "");
    setLastName(r.last_name ?? "");
    setEmail(r.email ?? "");
    setPhone(r.phone ?? "");

    setAddress(r.address ?? "");
    setMaritalStatus(r.marital_status ?? "");
    setChildrenCount(
      r.children_count === null || r.children_count === undefined
        ? ""
        : String(r.children_count),
    );

    setGender(r.gender ?? "");
    setAgeGroup(r.age_group ?? "");

    const fv = r.visitor_details?.first_visit_at ?? todayISODate();
    setFirstVisitAt(fv);

    const next = r.visitor_details?.next_follow_up_at ?? addDaysISO(fv, 3);
    setNextFollowUpAt(next);
    setNextFollowUpTouched(true);

    setHowHeard(r.visitor_details?.how_heard ?? "");
    setFollowUpNotes(r.visitor_details?.follow_up_notes ?? "");

    setPrayerItems(toPrayerItems(r.visitor_details?.prayer_request_tags));

    setAddOpen(true);
    setErr("");
  };

  const resetEmailForm = () => {
    setEmailErr("");
    setEmailFirstName("");
    setEmailAddress("");
    setIntakeUrl("");
  };

  const openFollowUp = (r: VisitorRow) => {
    if (!r.email) return;

    setFollowUpErr("");
    setFollowUpMember({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name ?? null,
      email: r.email,
      existing_notes: r.visitor_details?.follow_up_notes ?? null,
    });

    setFollowUpTo(r.email);
    setFollowUpReplyTo("");
    setFollowUpSubject("Welcome! Thanks for visiting");
    setFollowUpBody(
      "Hi {firstName},\n\nIt was great having you with us this Sunday. We’d love to stay connected. Feel free to reply to this email if you have any questions or prayer requests.\n\nBlessings,\n{churchName}",
    );

    setFollowUpOpen(true);
  };

  const sendFollowUpEmailInternal = async () => {
    setFollowUpErr("");

    if (!isAdmin) {
      setFollowUpErr("Only admins can send follow-ups.");
      return;
    }
    if (!followUpMember?.email) {
      setFollowUpErr("Missing recipient email.");
      return;
    }
    if (followUpTo.trim().length === 0 || !followUpTo.includes("@")) {
      setFollowUpErr("A valid 'To' email is required.");
      return;
    }
    if (followUpReplyTo.trim() && !followUpReplyTo.includes("@")) {
      setFollowUpErr("Reply-to must be a valid email (or blank).");
      return;
    }
    if (followUpSubject.trim().length === 0) {
      setFollowUpErr("Subject is required.");
      return;
    }
    if (followUpBody.trim().length === 0) {
      setFollowUpErr("Body is required.");
      return;
    }

    const vars = {
      firstName: followUpMember.first_name ?? "",
      lastName: followUpMember.last_name ?? "",
      churchName: orgName,
    };

    const payload = {
      member_id: followUpMember.id,
      to: followUpTo.trim(),
      reply_to: followUpReplyTo.trim() || null,
      subject: fillTemplate(followUpSubject, vars),
      body: fillTemplate(followUpBody, vars),
    };

    setFollowUpSending(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized. Please sign in again.");

      const res = await fetch("/api/followups/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {}

        const msg =
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed &&
          typeof (parsed as { error?: unknown }).error === "string"
            ? (parsed as { error: string }).error
            : text || "Failed to send follow-up.";

        throw new Error(msg);
      }

      showToast("Email sent ✓");
      setFollowUpOpen(false);

      const stamp = `Sent follow up email on ${todayISODate()}`;
      const prev = followUpMember.existing_notes?.trim() ?? "";
      const nextNotes = prev ? `${prev}\n${stamp}` : stamp;

      const { error: noteErr } = await supabase.from("visitor_details").upsert(
        {
          member_id: followUpMember.id,
          follow_up_notes: nextNotes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "member_id" },
      );

      if (noteErr) {
        setFollowUpErr(
          `Email sent, but failed to update notes: ${noteErr.message}`,
        );
      }

      // refresh
      await load();
    } catch (e) {
      setFollowUpErr(
        e instanceof Error ? e.message : "Failed to send follow-up.",
      );
    } finally {
      setFollowUpSending(false);
    }
  };

  const requestSendFollowUp = async () => {
    setFollowUpErr("");

    // keep all your existing validations (same as current)
    if (!isAdmin) {
      setFollowUpErr("Only admins can send follow-ups.");
      return;
    }
    if (!followUpMember?.email) {
      setFollowUpErr("Missing recipient email.");
      return;
    }
    if (followUpTo.trim().length === 0 || !followUpTo.includes("@")) {
      setFollowUpErr("A valid 'To' email is required.");
      return;
    }
    if (followUpReplyTo.trim() && !followUpReplyTo.includes("@")) {
      setFollowUpErr("Reply-to must be a valid email (or blank).");
      return;
    }
    if (followUpSubject.trim().length === 0) {
      setFollowUpErr("Subject is required.");
      return;
    }
    if (followUpBody.trim().length === 0) {
      setFollowUpErr("Body is required.");
      return;
    }

    // quota confirm
    await requestSend("followup", 1);
  };

  async function createCampaign() {
    if (!orgId) return;

    setCampaignErr("");
    setCampaignUrl("");
    setCampaignLoading(true);

    try {
      if (campaignLimitReached) {
        throw new Error(
          "Limit reached: max 2 active multiple-visitor links per organization.",
        );
      }

      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized. Please sign in again.");

      const days = campaignDays.trim() === "" ? 90 : Number(campaignDays);
      if (!Number.isFinite(days) || days <= 0)
        throw new Error("Days must be a valid number.");

      if (days >= 31)
        throw new Error(
          "Maximum allowed expiration is 30 days to prevent stale links. Please choose a shorter duration.",
        );

      const res = await fetch("/api/intake/campaign/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          org_id: orgId,
          name: campaignName.trim() || "Intake QR",
          expires_in_days: Math.floor(days),
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(json?.error ?? "Failed to create."));

      setCampaignUrl(String(json.campaignUrl));
      showToast("Campaign created ✓");

      // refresh pinned campaigns
      await load();
    } catch (e) {
      setCampaignErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setCampaignLoading(false);
    }
  }

  const load = async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    // org name
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (!orgErr && org?.name) setOrgName(org.name);

    // role
    const canEdit = await canEditPeopleForActiveOrg(orgId);
    setIsAdmin(canEdit);

    // campaigns (pinned) — expects table intake_campaigns
    // campaigns (pinned)
    try {
      const { data: campData, error: campErr } = await supabase
        .from("intake_campaigns")
        .select("id,name,slug,is_active,created_at,expires_at")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(2);

      if (campErr) throw campErr;

      const base =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== "undefined" ? window.location.origin : "");

      const normalized: CampaignRow[] = (campData as CampaignRowDb[])
        .filter((c) => !c.expires_at || new Date(c.expires_at) > new Date())
        .map((c) => ({
          id: c.id,
          name: c.name ?? "Campaign",
          slug: c.slug,
          is_active: c.is_active,
          created_at: c.created_at,
          expires_at: c.expires_at,
          url: `${base}/intake/c/${c.slug}`,
        }));

      setCampaigns(normalized);
    } catch (e) {
      setCampaigns([]);
    }

    // visitors
    const { data, error } = await supabase
      .from("members")
      .select(
        [
          "id,org_id,first_name,last_name,email,phone,status,created_at",
          "gender,age_group,segment,address,marital_status,children_count",
          "membership_stage,profile_complete,joined_at",
          "visitor_details!inner(first_visit_at,follow_up_status,next_follow_up_at,follow_up_notes,how_heard,prayer_request_tags)",
        ].join(","),
      )
      .eq("org_id", orgId)
      .eq("status", tab)
      .order("created_at", { ascending: false });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else if (isVisitorRowArray(data)) {
      setRows(data);
    } else {
      setErr("Unexpected response from server.");
      setRows([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let base = rows;

    if (show === "new") {
      base = base.filter(
        (r) => (r.visitor_details?.follow_up_status ?? "new") !== "joined",
      );
    } else if (show === "joined") {
      base = base.filter(
        (r) => r.visitor_details?.follow_up_status === "joined",
      );
    } else if (show === "due") {
      base = base.filter((r) => {
        const joined = r.visitor_details?.follow_up_status === "joined";
        return isDue(r.visitor_details?.next_follow_up_at ?? null, joined);
      });
    }

    if (!needle) return base;

    return base.filter((r) => {
      const name = `${r.first_name} ${r.last_name ?? ""}`.toLowerCase();
      const em = (r.email ?? "").toLowerCase();
      const ph = (r.phone ?? "").toLowerCase();
      return (
        name.includes(needle) || em.includes(needle) || ph.includes(needle)
      );
    });
  }, [rows, q, show]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const joined = rows.filter(
      (r) => r.visitor_details?.follow_up_status === "joined",
    ).length;
    const newCount = total - joined;
    const due = rows.filter((r) => {
      const joinedFlag = r.visitor_details?.follow_up_status === "joined";
      return isDue(r.visitor_details?.next_follow_up_at ?? null, joinedFlag);
    }).length;

    return { total, newCount, joined, due };
  }, [rows]);

  const archiveVisitor = async (id: string, next: "active" | "archived") => {
    if (!isAdmin) {
      showToast("Only finance/admin/owner can archive.");
      return;
    }

    const { error } = await supabase
      .from("members")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) showToast(error.message);
    else {
      showToast(next === "archived" ? "Archived" : "Restored");
      await load();
    }
  };

  const saveFirstTimer = async () => {
    if (!orgId) return;
    setAddErr("");

    if (firstName.trim().length === 0 || lastName.trim().length === 0) {
      setAddErr("First name and last name are required.");
      return;
    }
    if (!gender || !ageGroup) {
      setAddErr("Gender and age group are required.");
      return;
    }
    if (maritalStatus.trim().length === 0) {
      setAddErr("Marital status is required.");
      return;
    }
    if (address.trim().length === 0) {
      setAddErr("Home address is required.");
      return;
    }
    if (phone.trim().length === 0) {
      setAddErr("Phone is required.");
      return;
    }

    const cc = childrenCount.trim() === "" ? null : Number(childrenCount);
    if (cc === null || Number.isNaN(cc) || cc < 0) {
      setAddErr(
        "Children count is required and must be a valid non-negative number.",
      );
      return;
    }

    const seg = computeSegment(gender, ageGroup);

    setSavingAdd(true);
    try {
      if (mode === "create") {
        const { data: inserted, error: insErr } = await supabase
          .from("members")
          .insert({
            org_id: orgId,
            membership_stage: "visitor",
            profile_complete: false,

            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim() || null,
            phone: phone.trim() || null,

            gender,
            age_group: ageGroup,
            segment: seg,

            address: address.trim(),
            marital_status: maritalStatus.trim(),
            children_count: cc,
          })
          .select("id")
          .single();

        if (insErr) throw new Error(insErr.message);

        const memberId = inserted.id as string;

        const { error: vdErr } = await supabase.from("visitor_details").upsert(
          {
            member_id: memberId,
            first_visit_at: firstVisitAt || null,
            follow_up_status: "new",
            how_heard: howHeard.trim() || null,
            prayer_request_tags: fromPrayerItems(prayerItems),
            follow_up_notes: followUpNotes.trim() || null,
            next_follow_up_at: nextFollowUpAt || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "member_id" },
        );
        if (vdErr) throw new Error(vdErr.message);
      } else {
        if (!isAdmin)
          throw new Error("Only finance/admin/owner can edit first-timers.");
        if (!editId) throw new Error("Missing record id.");

        const { error: upErr } = await supabase
          .from("members")
          .update({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim() || null,
            phone: phone.trim() || null,

            gender,
            age_group: ageGroup,
            segment: seg,

            address: address.trim(),
            marital_status: maritalStatus.trim(),
            children_count: cc,

            profile_complete: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editId);

        if (upErr) throw new Error(upErr.message);

        const { error: vdErr } = await supabase.from("visitor_details").upsert(
          {
            member_id: editId,
            first_visit_at: firstVisitAt || null,
            how_heard: howHeard.trim() || null,
            prayer_request_tags: fromPrayerItems(prayerItems),
            follow_up_notes: followUpNotes.trim() || null,
            next_follow_up_at: nextFollowUpAt || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "member_id" },
        );

        if (vdErr) throw new Error(vdErr.message);
      }

      showToast(mode === "create" ? "Saved ✓" : "Updated ✓");
      setAddOpen(false);
      resetAddForm();
      await load();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSavingAdd(false);
    }
  };

  const sendIntakeForm = async () => {
    if (!orgId) return;
    setEmailErr("");

    if (intakeUrl) {
      // already created for this modal session; lock it
      showToast("Link already created");
      return;
    }

    if (emailFirstName.trim().length === 0) {
      setEmailErr("First name is required.");
      return;
    }
    const em = emailAddress.trim().toLowerCase();
    if (em.length === 0 || !em.includes("@")) {
      setEmailErr("A valid email is required.");
      return;
    }

    const { data: sessionRes } = await supabase.auth.getSession();
    const accessToken = sessionRes.session?.access_token;

    if (!accessToken) {
      setEmailErr("You must be signed in to send an intake form.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/intake/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          org_id: orgId,
          first_name: emailFirstName.trim(),
          email: em,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(String(json?.error ?? "Failed to send intake."));
      }

      const url = String(json?.intakeUrl ?? "");
      setIntakeUrl(url);

      showToast(json?.emailed ? "Email sent ✓" : "Link created ✓");
      await load();
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  const setJoined = async (memberId: string, joined: boolean) => {
    if (!isAdmin) {
      showToast("Only admins can change joined status.");
      return;
    }

    const next = joined ? "joined" : "new";
    const nowIso = todayISODate();

    // 1) visitor_details
    const { error: vdErr } = await supabase.from("visitor_details").upsert(
      {
        member_id: memberId,
        follow_up_status: next,
        updated_at: nowIso,
      },
      { onConflict: "member_id" },
    );
    if (vdErr) {
      showToast(vdErr.message);
      return;
    }

    // 2) members.joined_at
    if (joined) {
      const { error: mErr } = await supabase
        .from("members")
        .update({
          membership_stage: "member",
          joined_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", memberId);

      if (mErr) {
        showToast(
          `Marked joined, but failed to set joined_at: ${mErr.message}`,
        );
        return;
      }
    } else {
      // optional: clear it if you unmark joined
      const { error: mErr } = await supabase
        .from("members")
        .update({
          membership_stage: "visitor",
          joined_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", memberId);

      if (mErr) {
        showToast(
          `Unmarked joined, but failed to clear joined_at: ${mErr.message}`,
        );
        return;
      }
    }

    showToast(joined ? "Marked joined" : "Unmarked joined");
    await load();
  };

  const openNote = (r: VisitorRow) => {
    setNoteMemberId(r.id);
    setNoteText(r.visitor_details?.follow_up_notes ?? "");
    setNoteNextDate(r.visitor_details?.next_follow_up_at ?? "");
    setNoteOpen(true);
  };

  const saveNote = async () => {
    if (!noteMemberId) return;
    setNoteSaving(true);

    const { error } = await supabase.from("visitor_details").upsert(
      {
        member_id: noteMemberId,
        follow_up_notes: noteText.trim() || null,
        next_follow_up_at: noteNextDate || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id" },
    );

    if (error) showToast(error.message);
    else {
      showToast("Saved ✓");
      setNoteOpen(false);
      setNoteMemberId(null);
      setNoteText("");
      setNoteNextDate("");
      await load();
    }
    setNoteSaving(false);
  };

  async function openActiveIntakeLinkForMember(r: VisitorRow) {
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) {
        showToast("Please sign in again");
        return;
      }

      const res = await fetch(
        `/api/intake/active?member_id=${encodeURIComponent(r.id)}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      const json = await res.json().catch(() => null);
      const url = String(json?.intakeUrl ?? "");

      if (!url) {
        showToast("No active intake link");
        return;
      }

      openLinkModal({
        title: `${r.first_name} ${r.last_name ?? ""}`.trim() || "Visitor link",
        url,
        showQr: true,
      });
    } catch {
      showToast("Failed to fetch link");
    }
  }

  return (
    <>
      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4 mt-7">
          <div>
            <div className="text-xl font-semibold">First-Timers</div>
            <div className="text-sm text-slate-600">
              Capture guest info and track follow-ups.
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Generate dropdown */}
            <div className="relative">
              <button
                className="rounded-2xl border px-6 py-2 text-sm font-semibold hover:bg-slate-50"
                onClick={(e) => {
                  e.stopPropagation();
                  setGenMenuOpen((v) => !v);
                  setErr("");
                  setEmailErr("");
                  setCampaignErr("");
                }}
              >
                New Visitor Form Link
              </button>

              {genMenuOpen ? (
                <div
                  className="absolute right-0 mt-2 w-56 rounded-2xl border bg-white shadow-lg overflow-hidden z-50"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50"
                    onClick={() => {
                      setGenMenuOpen(false);
                      setEmailOpen(true);
                      resetEmailForm();
                    }}
                  >
                    Single visitor (email link)
                  </button>

                  <div className="h-px bg-slate-100" />

                  <button
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 ${
                      campaignLimitReached
                        ? "text-slate-400 cursor-not-allowed"
                        : ""
                    }`}
                    disabled={campaignLimitReached}
                    onClick={() => {
                      if (campaignLimitReached) return;
                      setGenMenuOpen(false);
                      setCampaignOpen(true);
                      setCampaignErr("");
                      setCampaignUrl("");
                      setCampaignName("Sunday Service");
                      setCampaignDays("3");
                    }}
                  >
                    Multiple visitors (QR Code)
                    {campaignLimitReached ? (
                      <div className="mt-1 text-xs text-slate-400">
                        Limit reached (max 2 active)
                      </div>
                    ) : null}
                  </button>
                </div>
              ) : null}
            </div>

            <button
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
              onClick={openCreate}
            >
              Add first-timer
            </button>
          </div>
        </div>

        <div className="px-6 pb-5">
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              {/* Active/Archived */}
              <div className="inline-flex rounded-2xl border bg-slate-50 p-1">
                <button
                  className={`rounded-2xl px-4 py-2 text-sm ${
                    tab === "active"
                      ? "bg-white border shadow-sm"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  onClick={() => setTab("active")}
                >
                  Active
                </button>

                <button
                  className={`rounded-2xl px-4 py-2 text-sm ${
                    tab === "archived"
                      ? "bg-white border shadow-sm"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  onClick={() => setTab("archived")}
                >
                  Archived
                </button>
              </div>
            </div>

            <input
              className="w-full sm:w-96 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Search name, phone, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        <div
          className="rounded-3xl border bg-white overflow-visible"
          ref={tableWrapRef}
        >
          <div className="overflow-x-auto overflow-y-visible">
            <div className="min-w-[1000px] overflow-visible">
              {/* KPI row */}
              <div className="border-b bg-white px-5 py-6">
                <div className="text-xs text-slate-500">
                  Click a card to filter the table.
                </div>

                <div className="mt-2 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => setShow("all")}
                    className={`rounded-2xl border px-4 py-3 text-left transition bg-white hover:bg-slate-50 ${
                      show === "all" ? "border-primary" : ""
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">
                      Total
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {kpis.total}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShow("new")}
                    className={`rounded-2xl border px-4 py-3 text-left transition hover:bg-slate-50 ${
                      show === "new"
                        ? "bg-primary/15 border-primary"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">
                      New
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {kpis.newCount}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShow("due")}
                    className={`rounded-2xl border px-4 py-3 text-left transition hover:bg-slate-50 ${
                      show === "due"
                        ? "bg-primary/15 border-primary"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">
                      Follow-ups due
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {kpis.due}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShow("joined")}
                    className={`rounded-2xl border px-4 py-3 text-left transition hover:bg-slate-50 ${
                      show === "joined"
                        ? "bg-primary/15 border-primary"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">
                      Joined
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {kpis.joined}
                    </div>
                  </button>
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  Showing{" "}
                  <span className="font-semibold">{filtered.length}</span>{" "}
                  {filtered.length === 1 ? "record" : "records"}
                  {q.trim() ? ` matching “${q.trim()}”` : ""}.
                </div>
              </div>

              {/* Header */}
              <div
                className="grid border-b bg-primary px-5 py-4 text-sm font-semibold text-slate-100"
                style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
              >
                <div className="col-span-4">Name</div>
                <div className="col-span-2">Phone</div>
                <div className="col-span-3">Email</div>
                <div className="col-span-2">First visit</div>
                <div className="col-span-5 text-right">Actions</div>
              </div>

              {loading ? (
                <div className="p-6 text-sm text-slate-600">Loading…</div>
              ) : filtered.length === 0 && campaigns.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  {q.trim()
                    ? "No first-timers match your search."
                    : "No records found."}
                </div>
              ) : (
                <div className="divide-y">
                  {/* Pinned campaign rows */}
                  {campaigns
                    .filter((c) => c.url)
                    .map((c) => (
                      <div
                        key={`campaign-${c.id}`}
                        className="grid items-center px-5 py-4 text-sm bg-slate-50"
                        style={{
                          gridTemplateColumns: "repeat(16, minmax(0, 1fr))",
                        }}
                      >
                        <div className="col-span-4">
                          <div className="font-semibold">{c.name}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            Multiple visitors link
                          </div>
                        </div>

                        <div className="col-span-2 text-slate-700">
                          Multiple
                        </div>
                        <div className="col-span-3 text-slate-700">
                          Multiple
                        </div>
                        <div className="col-span-2 text-slate-700">—</div>

                        <div className="col-span-5 flex justify-end gap-2">
                          <button
                            className="rounded-xl border px-5 py-1 text-xs hover:bg-white"
                            onClick={() =>
                              openLinkModal({
                                title: c.name,
                                url: c.url,
                                showQr: true,
                              })
                            }
                          >
                            View link
                          </button>

                          <button
                            className="rounded-xl border px-5 py-1 text-xs hover:bg-white"
                            onClick={() => {
                              openLinkModal({
                                title: c.name,
                                url: c.url,
                                showQr: true,
                              });
                              setAutoDownload(true);
                            }}
                          >
                            Download QR
                          </button>
                        </div>
                      </div>
                    ))}

                  {/* Visitor rows */}
                  {filtered.map((r) => {
                    const joinedFlag =
                      r.visitor_details?.follow_up_status === "joined";
                    const firstVisit = r.visitor_details?.first_visit_at || "—";

                    // ✅ Only show "View link" when they likely have a link (awaiting form)
                    const showViewLink = !r.profile_complete;

                    return (
                      <div
                        key={r.id}
                        className="grid items-center px-5 py-4 text-sm"
                        style={{
                          gridTemplateColumns: "repeat(16, minmax(0, 1fr))",
                        }}
                      >
                        <div className="col-span-4">
                          <div className="font-semibold capitalize">
                            {r.first_name} {r.last_name ?? ""}
                          </div>

                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span
                              className={`rounded-full px-2 py-0.5 border ${
                                joinedFlag
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                  : "bg-slate-50 border-slate-200 text-slate-700"
                              }`}
                            >
                              {joinedFlag ? "Joined" : "New"}
                            </span>

                            <span
                              className={`rounded-full px-2 py-0.5 border ${
                                r.profile_complete
                                  ? "bg-slate-50 border-slate-200 text-slate-700"
                                  : "bg-amber-50 border-amber-200 text-amber-800"
                              }`}
                            >
                              {r.profile_complete
                                ? "Profile complete"
                                : "Awaiting form"}
                            </span>

                            {isDue(
                              r.visitor_details?.next_follow_up_at ?? null,
                              joinedFlag,
                            ) ? (
                              <span className="rounded-full px-2 py-0.5 border bg-amber-50 border-amber-200 text-amber-800">
                                Due
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="col-span-2 text-slate-700">
                          {r.phone || "—"}
                        </div>
                        <div className="col-span-3 text-slate-700">
                          {r.email || "—"}
                        </div>
                        <div className="col-span-2 text-slate-700">
                          {firstVisit}
                        </div>

                        <div className="col-span-5 flex justify-end gap-2 relative">
                          <button
                            className="rounded-xl border px-5 py-1 text-xs hover:bg-slate-50"
                            onClick={() => openNote(r)}
                          >
                            Notes
                          </button>

                          {isAdmin && r.email ? (
                            <button
                              className="rounded-xl border px-5 py-1 text-xs hover:bg-slate-50"
                              onClick={() => openFollowUp(r)}
                            >
                              Follow up
                            </button>
                          ) : null}

                          <div className="relative">
                            <button
                              className="rounded-xl border px-5 py-1 text-xs hover:bg-slate-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                const btn =
                                  e.currentTarget as HTMLButtonElement;
                                const rect = btn.getBoundingClientRect();

                                setMenu((cur) =>
                                  cur?.id === r.id
                                    ? null
                                    : {
                                        id: r.id,
                                        top: rect.bottom + 8,
                                        right: window.innerWidth - rect.right,
                                      },
                                );
                              }}
                            >
                              More actions
                            </button>

                            {menu?.id === r.id &&
                            typeof document !== "undefined"
                              ? createPortal(
                                  <div
                                    style={{
                                      position: "fixed",
                                      top: menu.top,
                                      right: menu.right,
                                    }}
                                    className="w-44 rounded-2xl border bg-white shadow-lg z-[9999] overflow-hidden"
                                    onPointerDown={(e) => e.stopPropagation()}
                                  >
                                    {/* ✅ No link? Don't show this at all */}
                                    {showViewLink ? (
                                      <button
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                                        onClick={async () => {
                                          setMenu(null);
                                          await openActiveIntakeLinkForMember(
                                            r,
                                          );
                                        }}
                                      >
                                        View link
                                      </button>
                                    ) : null}

                                    <button
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                                      onClick={() => {
                                        setMenu(null);
                                        openEdit(r);
                                      }}
                                    >
                                      Edit
                                    </button>

                                    <button
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                                      onClick={() => {
                                        setMenu(null);
                                        setJoined(r.id, !joinedFlag);
                                      }}
                                    >
                                      {joinedFlag
                                        ? "Unmark joined"
                                        : "Mark joined"}
                                    </button>

                                    <div className="h-px bg-slate-100" />

                                    {r.status === "active" ? (
                                      <button
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                                        onClick={() => {
                                          setMenu(null);
                                          archiveVisitor(r.id, "archived");
                                        }}
                                      >
                                        Archive
                                      </button>
                                    ) : (
                                      <button
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                                        onClick={() => {
                                          setMenu(null);
                                          archiveVisitor(r.id, "active");
                                        }}
                                      >
                                        Restore
                                      </button>
                                    )}
                                  </div>,
                                  document.body,
                                )
                              : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {!isAdmin ? (
          <div className="mt-4 text-xs text-slate-500">
            Only admins/owners can mark someone as joined, send follow-ups, or
            archive records.
          </div>
        ) : null}
      </div>

      {/* ========== View link modal (single visitor / campaign) ========== */}
      {linkOpen ? (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 ${
            linkShowQr ? "backdrop-blur-md" : ""
          }`}
          onClick={() => setLinkOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">{linkTitle || "Link"}</div>
              <div className="text-xs text-slate-600">
                Copy the link or use the QR code.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              {linkShowQr ? (
                <div className="flex justify-center">
                  <div
                    ref={qrWrapRef}
                    className="rounded-3xl border bg-slate-50 p-6"
                  >
                    <QRCodeCanvas value={linkUrl} size={340} includeMargin />
                  </div>
                </div>
              ) : null}

              {linkShowQr ? (
                <button
                  className="w-full rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  onClick={() => downloadQrPng(linkTitle || "campaign")}
                >
                  Download QR (PNG)
                </button>
              ) : null}

              <div className="flex gap-2">
                <input
                  readOnly
                  value={linkUrl}
                  className="flex-1 rounded-2xl border px-3 py-2 text-sm"
                />
                <button
                  onClick={() => copyToClipboard(linkUrl)}
                  className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                >
                  Copy
                </button>
              </div>
              {/* 
              {linkShowQr ? (
                <button
                  className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  onClick={() => downloadQrPng(linkTitle || "campaign")}
                >
                  Download QR (PNG)
                </button>
              ) : null} */}
            </div>

            <div className="border-t px-4 py-4 flex justify-end">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setLinkOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== Modal C: Follow-up Email ========== */}
      {followUpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setFollowUpOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Send follow-up email</div>
              <div className="text-xs text-slate-600">
                Placeholders supported: {"{firstName}"} {"{lastName}"}{" "}
                {"{churchName}"}
              </div>
            </div>

            {followUpErr ? (
              <div className="mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {followUpErr}
              </div>
            ) : null}

            <div className="px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    To *
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={followUpTo}
                    onChange={(e) => setFollowUpTo(e.target.value)}
                    placeholder="recipient@example.com"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Reply-to
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={followUpReplyTo}
                    onChange={(e) => setFollowUpReplyTo(e.target.value)}
                    placeholder="staff@example.com (optional)"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Subject *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={followUpSubject}
                  onChange={(e) => setFollowUpSubject(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Body *
                </div>
                <textarea
                  className="w-full min-h-[220px] rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={followUpBody}
                  onChange={(e) => setFollowUpBody(e.target.value)}
                />
              </div>

              <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap">
                <div className="mb-2 font-semibold text-slate-600">Preview</div>
                {(() => {
                  const vars = {
                    firstName: followUpMember?.first_name ?? "",
                    lastName: followUpMember?.last_name ?? "",
                    churchName: orgName,
                  };
                  return fillTemplate(followUpBody, vars);
                })()}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-4 py-4">
              <button
                className="rounded-2xl border min-w-[96px] px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setFollowUpOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl min-w-[120px] px-4 py-2 text-sm font-semibold text-white ${
                  followUpSending
                    ? "bg-slate-300"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
                disabled={followUpSending}
                onClick={requestSendFollowUp}
              >
                {followUpSending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm Limits Modal */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-lg font-semibold">
                {insufficient ? "Insufficient email balance" : "Confirm send"}
              </div>
              <div className="text-sm text-slate-600">Monthly quota check.</div>
            </div>

            <div className="px-6 py-6 space-y-4">
              {confirmErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {confirmErr}
                </div>
              ) : null}

              {confirmLoading ? (
                <div className="text-sm text-slate-600">Checking quota…</div>
              ) : confirmErr ? null : (
                <>
                  <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Plan</span>
                      <span className="font-semibold capitalize">
                        {confirmPlan}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-slate-600">
                        Emails available now
                      </span>
                      <span className="font-semibold">{confirmLeftBefore}</span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-slate-600">This send will use</span>
                      <span className="font-semibold">{confirmCount}</span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-slate-600">Emails left after</span>
                      <span className="font-semibold">
                        {Math.max(0, confirmLeftBefore - confirmCount)}
                      </span>
                    </div>
                  </div>

                  {insufficient ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Sorry, you don&apos;t have enough emails left to send this
                      follow-up email
                      <div className="mt-2 text-xs text-amber-800">
                        Upgrade to a larger plan or wait until next month.
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-700">
                      This will use{" "}
                      <span className="font-semibold">{confirmCount}</span>{" "}
                      email{confirmCount === 1 ? "" : "s"}. Do you want to
                      proceed?
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  insufficient || confirmLoading || !!confirmErr
                    ? "bg-slate-300"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
                disabled={insufficient || confirmLoading || !!confirmErr}
                onClick={proceedSend}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== Modal A: Add/Edit first-timer (full intake) ========== */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                {mode === "create" ? "Add first-timer" : "Edit first-timer"}
              </div>

              <div className="text-xs text-slate-600">
                Fill the guest intake form. (You can also generate a form link
                instead.)
              </div>
            </div>

            {addErr ? (
              <div className="mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {addErr}
              </div>
            ) : null}

            <div className="max-h-[75vh] overflow-auto px-6 py-6 space-y-6">
              {/* Basics */}
              <div>
                <div className="text-xs font-semibold text-slate-600">
                  Basic info
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      First name *
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Last name *
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Email
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Phone *
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Home address *
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>

              {/* Details */}
              <div>
                <div className="text-xs font-semibold text-slate-600">
                  Details
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Gender *
                    </div>
                    <select
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={gender}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGender(v === "" ? "" : isGender(v) ? v : "");
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
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={ageGroup}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAgeGroup(v === "" ? "" : isAgeGroup(v) ? v : "");
                      }}
                    >
                      <option value="">Select…</option>
                      <option value="1-12">1 to 12</option>
                      <option value="13-17">13 to 17</option>
                      <option value="18-35">18 to 35</option>
                      <option value="36+">36 and above</option>
                    </select>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Segment (auto)
                    </div>
                    <input
                      readOnly
                      className="w-full rounded-2xl border bg-slate-50 px-4 py-2 text-sm text-slate-700"
                      value={
                        gender && ageGroup
                          ? computeSegment(gender, ageGroup)
                          : ""
                      }
                      placeholder="—"
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Marital status *
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={maritalStatus}
                      onChange={(e) => setMaritalStatus(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Children count *
                    </div>
                    <input
                      inputMode="numeric"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={childrenCount}
                      onChange={(e) => setChildrenCount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Visit */}
              <div>
                <div className="text-xs font-semibold text-slate-600">
                  Visit info
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      First visit
                    </div>
                    <input
                      type="date"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={firstVisitAt}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFirstVisitAt(v);
                        if (!nextFollowUpTouched)
                          setNextFollowUpAt(addDaysISO(v || todayISODate(), 3));
                      }}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Next follow-up
                    </div>
                    <input
                      type="date"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={nextFollowUpAt}
                      onChange={(e) => {
                        setNextFollowUpAt(e.target.value);
                        setNextFollowUpTouched(true);
                      }}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    How did you hear about us?
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={howHeard}
                    onChange={(e) => setHowHeard(e.target.value)}
                    placeholder="e.g., invited by a friend, social media, flyer..."
                  />
                </div>

                <div className="mt-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">
                    Prayer requests
                  </div>

                  <div className="space-y-2">
                    {prayerItems.map((it, idx) => (
                      <div key={it.id} className="flex items-center gap-2">
                        <input
                          className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                          value={it.text}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPrayerItems((cur) =>
                              cur.map((x) =>
                                x.id === it.id ? { ...x, text: v } : x,
                              ),
                            );
                          }}
                          placeholder={
                            idx === 0 ? "Family" : "Add a prayer request…"
                          }
                        />

                        {prayerItems.length > 1 ? (
                          <button
                            type="button"
                            className="rounded-2xl border px-3 py-2 text-xs hover:bg-slate-50"
                            onClick={() =>
                              setPrayerItems((cur) =>
                                cur.filter((x) => x.id !== it.id),
                              )
                            }
                            title="Remove"
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="mt-3 rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                    onClick={() =>
                      setPrayerItems((cur) => [
                        ...cur,
                        { id: makeId(), text: "" },
                      ])
                    }
                  >
                    + Add item
                  </button>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Notes
                  </div>
                  <textarea
                    className="w-full min-h-[90px] rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={followUpNotes}
                    onChange={(e) => setFollowUpNotes(e.target.value)}
                    placeholder="Follow-up notes eg: interested in volunteering, wants prayer, etc."
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-4 py-4">
              <button
                className="rounded-2xl border min-w-[96px] px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => {
                  setAddOpen(false);
                  resetAddForm();
                }}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl min-w-[120px] px-4 py-2 text-sm font-semibold text-white ${
                  savingAdd ? "bg-slate-300" : "bg-slate-900 hover:bg-slate-800"
                }`}
                disabled={savingAdd}
                onClick={saveFirstTimer}
              >
                {savingAdd
                  ? "Saving…"
                  : mode === "create"
                    ? "Save"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== Modal D: Create campaign link (QR code) ========== */}
      {campaignOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">
                  Create multiple visitors link
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Generates a shareable link you can turn into a QR code.
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Limit: max 2 active multiple-visitor links per organization.
                </div>
              </div>
              <button
                onClick={() => setCampaignOpen(false)}
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Service name
                </div>
                <input
                  value={campaignName}
                  disabled={Boolean(campaignUrl) || campaignLoading}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  placeholder="Sunday Service"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Expires in (days)
                </div>
                <input
                  inputMode="numeric"
                  value={campaignDays}
                  disabled={Boolean(campaignUrl) || campaignLoading}
                  onChange={(e) => setCampaignDays(e.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
                  placeholder="1"
                />
              </div>

              <button
                onClick={createCampaign}
                disabled={
                  campaignLoading ||
                  !orgId ||
                  campaignLimitReached ||
                  Boolean(campaignUrl)
                }
                className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white
    hover:bg-primary/85 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {campaignUrl
                  ? "Link generated ✓"
                  : campaignLimitReached
                    ? "Limit reached (max 2 active)"
                    : campaignLoading
                      ? "Creating..."
                      : "Create link"}
              </button>

              {campaignErr ? (
                <div className="text-sm text-red-600">{campaignErr}</div>
              ) : null}

              {campaignUrl ? (
                <div className="rounded-2xl border p-4 space-y-4">
                  <div className="text-sm font-semibold">Campaign link</div>

                  <div className="flex justify-center">
                    <div className="rounded-3xl border bg-slate-50 p-6">
                      <QRCodeCanvas
                        value={campaignUrl}
                        size={280}
                        includeMargin
                      />
                    </div>
                  </div>

                  <div className="mt-2 flex gap-2">
                    <input
                      readOnly
                      value={campaignUrl}
                      className="flex-1 rounded-2xl border px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => copyToClipboard(campaignUrl)}
                      className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                    >
                      Copy
                    </button>
                  </div>

                  <div className="text-xs text-slate-500 text-center">
                    Guests can scan this QR code to fill the form.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== Modal B: Email intake form (minimal) ========== */}
      {emailOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                Single visitor intake link
              </div>
              <div className="text-xs text-slate-600">
                We’ll email a secure link so they can fill their details
                themselves.
              </div>
            </div>

            {emailErr ? (
              <div className="mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {emailErr}
              </div>
            ) : null}

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  First name *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={emailFirstName}
                  onChange={(e) => setEmailFirstName(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Email *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>

              {intakeUrl ? (
                <div className="mt-5 rounded-2xl border p-4">
                  <div className="text-sm font-semibold">Intake link</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      readOnly
                      value={intakeUrl}
                      className="flex-1 rounded-2xl border px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => copyToClipboard(intakeUrl)}
                      className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Link created. Expires in 3 days.
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-xs text-slate-600">
                They’ll be able to complete: last name, phone, gender, age
                group, marital status, children count, home address, and prayer
                request.
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-4 py-4">
              <button
                className="rounded-2xl border min-w-[96px] px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => {
                  setEmailOpen(false);
                  resetEmailForm();
                }}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl min-w-[120px] px-4 py-2 text-sm font-semibold text-white ${
                  sending || Boolean(intakeUrl)
                    ? "bg-slate-300"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
                disabled={sending || Boolean(intakeUrl)}
                onClick={sendIntakeForm}
              >
                {sending ? "Sending…" : intakeUrl ? "Sent" : "Send form"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== Quick notes modal ========== */}
      {noteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setNoteOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Follow-up notes</div>
              <div className="text-xs text-slate-600">
                Add notes and an optional next follow-up date.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Notes
                </div>
                <textarea
                  className="w-full min-h-[110px] rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="e.g., Called on Tuesday. Will follow up next week…"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Next follow-up
                </div>
                <input
                  type="date"
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={noteNextDate}
                  onChange={(e) => setNoteNextDate(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-4 py-4">
              <button
                className="rounded-2xl border min-w-[96px] px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setNoteOpen(false)}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl min-w-[96px] px-4 py-2 text-sm font-semibold text-white ${
                  noteSaving
                    ? "bg-slate-300"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
                disabled={noteSaving}
                onClick={saveNote}
              >
                {noteSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toast */}
      {toastOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed bottom-6 right-6 z-[99999]">
              <div className="rounded-2xl bg-slate-900 text-white px-4 py-3 text-sm shadow-lg">
                {toastText}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
