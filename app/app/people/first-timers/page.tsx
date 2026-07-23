"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { QRCodeCanvas } from "qrcode.react";

/* ===================== Types ===================== */

type ShowFilter = "new" | "followups" | "joined" | "all";
type FollowupListView = "current" | "history" | "archived";

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

type ScheduledFollowupStatus =
  | "pending"
  | "sent"
  | "failed"
  | "cancelled"
  | "blocked_quota";

type ScheduledFollowupRow = {
  id: string;
  org_id: string;
  member_id: string;
  channel: "email";
  followup_label: string;
  day_offset: number | null;
  scheduled_for: string;
  subject: string;
  body: string;
  reply_to: string | null;
  status: ScheduledFollowupStatus;
  error_message: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;

  members?: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    visitor_details?: {
      first_visit_at: string | null;
    } | null;
  } | null;
};

type FollowupSettings = {
  org_id: string;
  automation_enabled: boolean;
  default_reply_to: string | null;
  timezone_name: string;
  send_time: string;
};

type FollowupAutomationTemplate = {
  id?: string;
  step_order: number;
  day_offset: number;
  label: string;
  subject: string;
  body: string;
};

type PendingSendAction = "followup" | "scheduled_followup";
type PlanKey = "free" | "basic" | "pro" | "enterprise";

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
      o.plan === "pro" ||
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

function isScheduledFollowupRowArray(v: unknown): v is ScheduledFollowupRow[] {
  return (
    Array.isArray(v) &&
    (v.length === 0 ||
      (typeof v[0] === "object" &&
        v[0] !== null &&
        "id" in v[0] &&
        "scheduled_for" in v[0] &&
        "followup_label" in v[0] &&
        "status" in v[0]))
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

const DEFAULT_FOLLOWUP_STEPS: FollowupAutomationTemplate[] = [
  {
    step_order: 1,
    day_offset: 0,
    label: "Day 0: Thank you for visiting",
    subject: "Thank you for visiting {churchName}",
    body: "Hi {firstName},\n\nThank you for visiting {churchName}. It was a blessing to have you with us.\n\nWe hope you felt welcomed, and we would love to see you again soon.\n\nBlessings,\n{churchName}",
  },
  {
    step_order: 2,
    day_offset: 3,
    label: "Day 3: Hope to see you again",
    subject: "We hope to see you again soon",
    body: "Hi {firstName},\n\nWe just wanted to check in and say we were glad you visited {churchName}.\n\nIf you have any questions or prayer requests, feel free to reply to this email.\n\nBlessings,\n{churchName}",
  },
  {
    step_order: 3,
    day_offset: 7,
    label: "Day 7: Invite to community group",
    subject: "Would you like to connect with a group?",
    body: "Hi {firstName},\n\nWe would love to help you get more connected at {churchName}.\n\nIf you are interested, we can share more information about our community groups, ministries, or next steps.\n\nBlessings,\n{churchName}",
  },
  {
    step_order: 4,
    day_offset: 14,
    label: "Day 14: Pastoral check-in",
    subject: "Checking in from {churchName}",
    body: "Hi {firstName},\n\nWe wanted to check in again and let you know we are grateful you visited {churchName}.\n\nPlease let us know if there is any way we can pray for you or support you.\n\nBlessings,\n{churchName}",
  },
];

function copyDefaultFollowupSteps(): FollowupAutomationTemplate[] {
  return DEFAULT_FOLLOWUP_STEPS.map((step) => ({ ...step }));
}

function makeScheduledForISO(
  firstVisitISODate: string,
  dayOffset: number,
  sendTime: string,
) {
  const [hhRaw, mmRaw] = sendTime.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);

  const base = new Date(`${firstVisitISODate}T00:00:00`);
  base.setDate(base.getDate() + dayOffset);
  base.setHours(
    Number.isFinite(hh) ? hh : 18,
    Number.isFinite(mm) ? mm : 0,
    0,
    0,
  );

  return base.toISOString();
}

function makeDateTimeISO(dateISO: string, timeHHMM: string) {
  const [hhRaw, mmRaw] = timeHHMM.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);

  const d = new Date(`${dateISO || todayISODate()}T00:00:00`);
  d.setHours(Number.isFinite(hh) ? hh : 18, Number.isFinite(mm) ? mm : 0, 0, 0);

  return d.toISOString();
}

function isoToDateInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayISODate();

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function isoToTimeInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "18:00";

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  return `${hh}:${mm}`;
}

/* ===================== Page ===================== */

export default function FirstTimersPage() {
  const orgId = getActiveOrgId();

  // ===== List page state =====
  const [q, setQ] = useState("");
  const [show, setShow] = useState<ShowFilter>("new");
  const [followupListView, setFollowupListView] =
    useState<FollowupListView>("current");

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

  // ===== Scheduled follow-ups =====
  const [scheduledFollowups, setScheduledFollowups] = useState<
    ScheduledFollowupRow[]
  >([]);
  const [followupSettings, setFollowupSettings] =
    useState<FollowupSettings | null>(null);
  const [followupTemplates, setFollowupTemplates] = useState<
    FollowupAutomationTemplate[]
  >(copyDefaultFollowupSteps);
  const [templateSettingsOpen, setTemplateSettingsOpen] = useState(false);
  const [savingFollowupTemplates, setSavingFollowupTemplates] = useState(false);
  const [followupTemplateErr, setFollowupTemplateErr] = useState("");

  const [savingFollowupSettings, setSavingFollowupSettings] = useState(false);

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
  const [campaignDays, setCampaignDays] = useState("1000");
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

  const [scheduleSendOpen, setScheduleSendOpen] = useState(false);
  const [scheduleSendDate, setScheduleSendDate] = useState(todayISODate());
  const [scheduleSendTime, setScheduleSendTime] = useState("18:00");
  const [scheduleSendSaving, setScheduleSendSaving] = useState(false);

  // ===== Modal E: Scheduled follow-up preview =====
  const [scheduledPreviewOpen, setScheduledPreviewOpen] = useState(false);
  const [scheduledPreview, setScheduledPreview] =
    useState<ScheduledFollowupRow | null>(null);
  const [cancellingScheduledId, setCancellingScheduledId] = useState<
    string | null
  >(null);

  const [unarchivingScheduledId, setUnarchivingScheduledId] = useState<
    string | null
  >(null);

  const [sendingScheduledId, setSendingScheduledId] = useState<string | null>(
    null,
  );

  const [pendingScheduledSend, setPendingScheduledSend] =
    useState<ScheduledFollowupRow | null>(null);

  const [replyToFocused, setReplyToFocused] = useState(false);

  const [scheduledEditMode, setScheduledEditMode] = useState(false);
  const [scheduledEditSubject, setScheduledEditSubject] = useState("");
  const [scheduledEditBody, setScheduledEditBody] = useState("");
  const [scheduledEditReplyTo, setScheduledEditReplyTo] = useState("");
  const [scheduledEditDate, setScheduledEditDate] = useState(todayISODate());
  const [scheduledEditTime, setScheduledEditTime] = useState("18:00");
  const [scheduledEditSaving, setScheduledEditSaving] = useState(false);
  const [scheduledEditErr, setScheduledEditErr] = useState("");

  // NEW: used to auto-download when user clicks “Download” in table
  const [autoDownload, setAutoDownload] = useState(false);

  // NEW: ref to find the QR canvas reliably (no ref forwarding needed)
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  async function updateFollowupSettingsPatch(
    patch: Partial<
      Pick<
        FollowupSettings,
        | "automation_enabled"
        | "default_reply_to"
        | "timezone_name"
        | "send_time"
      >
    >,
  ) {
    if (!orgId) return;

    if (!isAdmin) {
      showToast("Only finance/admin/owner can manage automated follow-ups.");
      return;
    }

    const current = followupSettings ?? {
      org_id: orgId,
      automation_enabled: false,
      default_reply_to: null,
      timezone_name: "America/New_York",
      send_time: "18:00:00",
    };

    const next: FollowupSettings = {
      ...current,
      ...patch,
      org_id: orgId,
    };

    setSavingFollowupSettings(true);

    const { error } = await supabase.from("followup_settings").upsert(
      {
        org_id: orgId,
        automation_enabled: next.automation_enabled,
        default_reply_to: next.default_reply_to,
        timezone_name: next.timezone_name || "America/New_York",
        send_time: next.send_time || "18:00:00",
      },
      { onConflict: "org_id" },
    );

    setSavingFollowupSettings(false);

    if (error) {
      showToast(error.message);
      return;
    }

    setFollowupSettings(next);
    showToast(
      next.automation_enabled
        ? "Automated follow-ups enabled"
        : "Automated follow-ups disabled",
    );
  }

  async function saveFollowupTemplates() {
    if (!orgId || !isAdmin) return;

    setFollowupTemplateErr("");

    const normalized = followupTemplates.map((step, index) => ({
      step_order: index + 1,
      day_offset: Math.trunc(Number(step.day_offset)),
      label: step.label.trim(),
      subject: step.subject.trim(),
      body: step.body.trim(),
    }));

    if (
      normalized.some(
        (step) =>
          !Number.isFinite(step.day_offset) ||
          step.day_offset < 0 ||
          step.day_offset > 365,
      )
    ) {
      setFollowupTemplateErr("Each send day must be between 0 and 365.");
      return;
    }

    if (
      new Set(normalized.map((step) => step.day_offset)).size !==
      normalized.length
    ) {
      setFollowupTemplateErr("Each follow-up must use a different send day.");
      return;
    }

    if (normalized.some((step) => !step.label || !step.subject || !step.body)) {
      setFollowupTemplateErr("Label, email subject, and message are required.");
      return;
    }

    setSavingFollowupTemplates(true);
    const { error } = await supabase.rpc("save_followup_automation_templates", {
      p_org_id: orgId,
      p_templates: normalized,
    });
    setSavingFollowupTemplates(false);

    if (error) {
      setFollowupTemplateErr(error.message);
      return;
    }

    setFollowupTemplates(normalized);
    setTemplateSettingsOpen(false);
    showToast("Follow-up sequence saved");
  }

  async function createDefaultScheduledFollowupsForMember(opts: {
    memberId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    firstVisitAt: string;
  }) {
    if (!orgId) return;
    if (!opts.email) return;
    if (!followupSettings?.automation_enabled) return;

    const vars = {
      firstName: opts.firstName,
      lastName: opts.lastName,
      churchName: orgName,
    };

    const sendTime = followupSettings.send_time || "18:00:00";

    const rowsToInsert = followupTemplates.map((step) => ({
      org_id: orgId,
      member_id: opts.memberId,
      channel: "email",
      followup_label: step.label,
      day_offset: step.day_offset,
      scheduled_for: makeScheduledForISO(
        opts.firstVisitAt || todayISODate(),
        step.day_offset,
        sendTime,
      ),
      subject: fillTemplate(step.subject, vars),
      body: fillTemplate(step.body, vars),
      reply_to: followupSettings.default_reply_to || null,
      status: "pending",
    }));

    const { error } = await supabase
      .from("scheduled_followups")
      .upsert(rowsToInsert, {
        onConflict: "org_id,member_id,day_offset",
        ignoreDuplicates: true,
      });

    if (error) {
      showToast(`Saved, but follow-ups were not scheduled: ${error.message}`);
    }
  }

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
      return;
    }

    if (confirmAction === "scheduled_followup") {
      await sendScheduledFollowupNowInternal();
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

  const openScheduledPreview = (f: ScheduledFollowupRow) => {
    setScheduledPreview(f);
    setScheduledPreviewOpen(true);

    setScheduledEditMode(false);
    setScheduledEditErr("");
    setScheduledEditSubject(f.subject);
    setScheduledEditBody(f.body);
    setScheduledEditReplyTo(f.reply_to ?? "");
    setScheduledEditDate(isoToDateInput(f.scheduled_for));
    setScheduledEditTime(isoToTimeInput(f.scheduled_for));
  };

  const saveScheduledFollowupEdits = async () => {
    setScheduledEditErr("");

    if (!scheduledPreview) return;

    if (!isAdmin) {
      setScheduledEditErr(
        "Only finance/admin/owner can edit scheduled follow-ups.",
      );
      return;
    }

    if (scheduledPreview.status !== "pending") {
      setScheduledEditErr("Only pending scheduled follow-ups can be edited.");
      return;
    }

    if (scheduledPreview.archived_at) {
      setScheduledEditErr("Archived follow-ups are read-only and cannot send.");
      return;
    }

    if (scheduledEditSubject.trim().length === 0) {
      setScheduledEditErr("Subject is required.");
      return;
    }

    if (scheduledEditBody.trim().length === 0) {
      setScheduledEditErr("Body is required.");
      return;
    }

    if (scheduledEditReplyTo.trim() && !scheduledEditReplyTo.includes("@")) {
      setScheduledEditErr("Reply-to must be a valid email or blank.");
      return;
    }

    if (!scheduledEditDate) {
      setScheduledEditErr("Scheduled date is required.");
      return;
    }

    const scheduledFor = makeDateTimeISO(scheduledEditDate, scheduledEditTime);

    setScheduledEditSaving(true);

    const { error } = await supabase
      .from("scheduled_followups")
      .update({
        scheduled_for: scheduledFor,
        subject: scheduledEditSubject.trim(),
        body: scheduledEditBody.trim(),
        reply_to: scheduledEditReplyTo.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", scheduledPreview.id)
      .eq("status", "pending");

    setScheduledEditSaving(false);

    if (error) {
      setScheduledEditErr(error.message);
      return;
    }

    const updated: ScheduledFollowupRow = {
      ...scheduledPreview,
      scheduled_for: scheduledFor,
      subject: scheduledEditSubject.trim(),
      body: scheduledEditBody.trim(),
      reply_to: scheduledEditReplyTo.trim() || null,
      updated_at: new Date().toISOString(),
    };

    setScheduledPreview(updated);
    setScheduledEditMode(false);
    showToast("Scheduled follow-up updated");
    await load();
  };

  const cancelScheduledFollowup = async (id: string) => {
    if (!isAdmin) {
      showToast("Only finance/admin/owner can cancel scheduled follow-ups.");
      return;
    }

    setCancellingScheduledId(id);

    const { error } = await supabase
      .from("scheduled_followups")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending");

    setCancellingScheduledId(null);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Scheduled follow-up cancelled");
    await load();
  };

  const sendScheduledFollowupNowInternal = async () => {
    const followup = pendingScheduledSend;

    if (!followup) return;

    setScheduledEditErr("");

    if (!isAdmin) {
      setScheduledEditErr(
        "Only finance/admin/owner can send scheduled follow-ups.",
      );
      return;
    }

    if (followup.status !== "pending") {
      setScheduledEditErr("Only pending follow-ups can be sent.");
      return;
    }

    if (followup.archived_at) {
      setScheduledEditErr("Restore this follow-up before sending it.");
      return;
    }

    const recipientEmail = followup.members?.email?.trim();

    if (!recipientEmail || !recipientEmail.includes("@")) {
      setScheduledEditErr("The recipient does not have a valid email address.");
      return;
    }

    setSendingScheduledId(followup.id);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;

      if (!jwt) {
        throw new Error("Unauthorized. Please sign in again.");
      }

      const res = await fetch("/api/followups/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          member_id: followup.member_id,
          scheduled_followup_id: followup.id,
          to: recipientEmail,
          reply_to: followup.reply_to || null,
          subject: followup.subject,
          body: followup.body,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let parsed: unknown = null;

        try {
          parsed = JSON.parse(text);
        } catch {}

        const message =
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed &&
          typeof (parsed as { error?: unknown }).error === "string"
            ? (parsed as { error: string }).error
            : text || "Failed to send scheduled follow-up.";

        throw new Error(message);
      }

      showToast("Scheduled follow-up sent");

      setScheduledPreviewOpen(false);
      setScheduledPreview(null);
      setPendingScheduledSend(null);

      await load();
    } catch (error) {
      setScheduledEditErr(
        error instanceof Error
          ? error.message
          : "Failed to send scheduled follow-up.",
      );
    } finally {
      setSendingScheduledId(null);
    }
  };

  const archiveScheduledFollowup = async (id: string) => {
    if (!isAdmin) {
      showToast("Only finance/admin/owner can archive scheduled follow-ups.");
      return;
    }

    const { error } = await supabase
      .from("scheduled_followups")
      .update({
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["sent", "cancelled"]);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Scheduled follow-up archived");
    await load();
  };

  const unarchiveScheduledFollowup = async (id: string) => {
    if (!isAdmin) {
      showToast("Only finance/admin/owner can restore scheduled follow-ups.");
      return;
    }

    setUnarchivingScheduledId(id);

    const { error } = await supabase
      .from("scheduled_followups")
      .update({
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .not("archived_at", "is", null);

    setUnarchivingScheduledId(null);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Scheduled follow-up restored");
    setFollowupListView("history");
    await load();
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

    setScheduleSendOpen(false);
    setScheduleSendDate(todayISODate());
    setScheduleSendTime(
      followupSettings?.send_time
        ? followupSettings.send_time.slice(0, 5)
        : "18:00",
    );

    setFollowUpOpen(true);
  };

  const sendFollowUpEmailInternal = async () => {
    setFollowUpErr("");

    if (!isAdmin) {
      setFollowUpErr("Only finance, admins, and owners can send follow-ups.");
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

      showToast("Email sent");
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

  const scheduleFollowUpEmail = async () => {
    setFollowUpErr("");

    if (!isAdmin) {
      setFollowUpErr("Only finance/admin/owner can schedule follow-ups.");
      return;
    }
    if (!orgId) {
      setFollowUpErr("Missing organization.");
      return;
    }
    if (!followUpMember?.id || !followUpMember.email) {
      setFollowUpErr("Missing recipient.");
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
    if (!scheduleSendDate) {
      setFollowUpErr("Schedule date is required.");
      return;
    }

    const vars = {
      firstName: followUpMember.first_name ?? "",
      lastName: followUpMember.last_name ?? "",
      churchName: orgName,
    };

    const scheduledFor = makeDateTimeISO(scheduleSendDate, scheduleSendTime);

    setScheduleSendSaving(true);

    const { error } = await supabase.from("scheduled_followups").insert({
      org_id: orgId,
      member_id: followUpMember.id,
      channel: "email",
      followup_label: "Custom scheduled follow-up",
      day_offset: null,
      scheduled_for: scheduledFor,
      subject: fillTemplate(followUpSubject, vars),
      body: fillTemplate(followUpBody, vars),
      reply_to:
        followUpReplyTo.trim() || followupSettings?.default_reply_to || null,
      status: "pending",
    });

    setScheduleSendSaving(false);

    if (error) {
      setFollowUpErr(error.message);
      return;
    }

    showToast("Follow-up scheduled");
    setFollowUpOpen(false);
    setScheduleSendOpen(false);
    await load();
  };

  const requestSendFollowUp = async () => {
    setFollowUpErr("");

    // keep all your existing validations (same as current)
    if (!isAdmin) {
      setFollowUpErr("Only finance, admins, and owners can send follow-ups.");
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

      const days = campaignDays.trim() === "" ? 999 : Number(campaignDays);
      if (!Number.isFinite(days) || days <= 0)
        throw new Error("Days must be a valid number.");

      if (days >= 10000)
        throw new Error(
          "Maximum allowed expiration is 10,000 days to prevent stale links. Please choose a shorter duration.",
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
      showToast("Campaign created");

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

    // follow-up settings
    try {
      const { data: settingsData, error: settingsErr } = await supabase
        .from("followup_settings")
        .select(
          "org_id,automation_enabled,default_reply_to,timezone_name,send_time",
        )
        .eq("org_id", orgId)
        .maybeSingle();

      if (settingsErr) throw settingsErr;

      setFollowupSettings(
        settingsData
          ? (settingsData as FollowupSettings)
          : {
              org_id: orgId,
              automation_enabled: false,
              default_reply_to: null,
              timezone_name: "America/New_York",
              send_time: "18:00:00",
            },
      );
    } catch {
      setFollowupSettings({
        org_id: orgId,
        automation_enabled: false,
        default_reply_to: null,
        timezone_name: "America/New_York",
        send_time: "18:00:00",
      });
    }

    // Organization-specific automation templates. If none have ever been
    // saved, preserve the original four-step sequence as the default.
    try {
      const { data: templateData, error: templateErr } = await supabase
        .from("followup_automation_templates")
        .select("id,step_order,day_offset,label,subject,body")
        .eq("org_id", orgId)
        .order("step_order", { ascending: true });

      if (templateErr) throw templateErr;

      setFollowupTemplates(
        templateData && templateData.length > 0
          ? (templateData as FollowupAutomationTemplate[])
          : copyDefaultFollowupSteps(),
      );
    } catch {
      setFollowupTemplates(copyDefaultFollowupSteps());
    }

    // scheduled follow-ups
    try {
      const { data: sfData, error: sfErr } = await supabase
        .from("scheduled_followups")
        .select(
          [
            "id,org_id,member_id,channel,followup_label,day_offset,scheduled_for",
            "subject,body,reply_to,status,error_message,sent_at,cancelled_at,archived_at,created_at,updated_at",
            "members!inner(id,first_name,last_name,email,visitor_details(first_visit_at))",
          ].join(","),
        )
        .eq("org_id", orgId)
        .order("scheduled_for", { ascending: true });

      if (sfErr) throw sfErr;

      if (isScheduledFollowupRowArray(sfData)) {
        setScheduledFollowups(sfData);
      } else {
        setScheduledFollowups([]);
      }
    } catch {
      setScheduledFollowups([]);
    }

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

    if (show === "new" || show === "followups") {
      base = base.filter(
        (r) => (r.visitor_details?.follow_up_status ?? "new") !== "joined",
      );
    } else if (show === "joined") {
      base = base.filter(
        (r) => r.visitor_details?.follow_up_status === "joined",
      );
    }

    if (!needle) return base;

    return base.filter((r) => {
      const name = `${r.first_name} ${r.last_name ?? ""}`.toLowerCase();
      const em = (r.email ?? "").toLowerCase();
      const ph = (r.phone ?? "").toLowerCase();
      const heard = (r.visitor_details?.how_heard ?? "").toLowerCase();

      return (
        name.includes(needle) ||
        em.includes(needle) ||
        ph.includes(needle) ||
        heard.includes(needle)
      );
    });
  }, [rows, q, show]);

  const filteredScheduledFollowups = useMemo(() => {
    const needle = q.trim().toLowerCase();

    const statusRank: Record<ScheduledFollowupStatus, number> = {
      pending: 1,
      failed: 2,
      blocked_quota: 3,
      cancelled: 4,
      sent: 5,
    };

    const getName = (f: ScheduledFollowupRow) =>
      `${f.members?.first_name ?? ""} ${f.members?.last_name ?? ""}`
        .trim()
        .toLowerCase();

    let base = scheduledFollowups.filter((f) => {
      if (followupListView === "archived") {
        return Boolean(f.archived_at);
      }

      if (followupListView === "history") {
        return (
          !f.archived_at && (f.status === "sent" || f.status === "cancelled")
        );
      }

      return (
        !f.archived_at &&
        (f.status === "pending" ||
          f.status === "failed" ||
          f.status === "blocked_quota")
      );
    });

    if (needle) {
      base = base.filter((f) => {
        const name = getName(f);
        const email = (f.members?.email ?? "").toLowerCase();
        const label = f.followup_label.toLowerCase();
        const subject = f.subject.toLowerCase();
        const status = f.status.toLowerCase();

        return (
          name.includes(needle) ||
          email.includes(needle) ||
          label.includes(needle) ||
          subject.includes(needle) ||
          status.includes(needle)
        );
      });
    }

    return [...base].sort((a, b) => {
      const statusDiff = statusRank[a.status] - statusRank[b.status];
      if (statusDiff !== 0) return statusDiff;

      const dateDiff =
        new Date(a.scheduled_for).getTime() -
        new Date(b.scheduled_for).getTime();

      if (dateDiff !== 0) return dateDiff;

      return getName(a).localeCompare(getName(b));
    });
  }, [scheduledFollowups, q, followupListView]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const joined = rows.filter(
      (r) => r.visitor_details?.follow_up_status === "joined",
    ).length;
    const newCount = total - joined;

    const followups = scheduledFollowups.filter(
      (f) =>
        !f.archived_at &&
        (f.status === "pending" ||
          f.status === "failed" ||
          f.status === "blocked_quota"),
    ).length;

    return { total, newCount, joined, followups };
  }, [rows, scheduledFollowups]);

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

    if (phone.trim().length === 0) {
      setAddErr("Phone is required.");
      return;
    }

    const cc = childrenCount.trim() === "" ? null : Number(childrenCount);

    if (cc !== null && (Number.isNaN(cc) || cc < 0)) {
      setAddErr("Children count must be a valid non-negative number.");
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
            profile_complete: true,

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

        await createDefaultScheduledFollowupsForMember({
          memberId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || null,
          firstVisitAt: firstVisitAt || todayISODate(),
        });
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

      showToast(mode === "create" ? "Saved" : "Updated");
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

      showToast(json?.emailed ? "Email sent" : "Link created");
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
      showToast("Saved");
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

            <div className="hidden lg:flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">
                  Automated follow-ups
                </div>
              </div>

              <button
                type="button"
                disabled={savingFollowupSettings || !isAdmin}
                onClick={() =>
                  updateFollowupSettingsPatch({
                    automation_enabled: !followupSettings?.automation_enabled,
                  })
                }
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  followupSettings?.automation_enabled
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-slate-50 text-slate-700 border border-slate-200"
                } ${
                  savingFollowupSettings || !isAdmin
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-slate-50"
                }`}
              >
                {savingFollowupSettings
                  ? "Saving..."
                  : followupSettings?.automation_enabled
                    ? "On"
                    : "Off"}
              </button>
            </div>
            <div className="relative">
              <button
                className="rounded-2xl bg-primary border px-6 py-2 text-sm font-semibold text-white hover:bg-primary/85"
                onClick={(e) => {
                  e.stopPropagation();
                  setGenMenuOpen((v) => !v);
                  setErr("");
                  setEmailErr("");
                  setCampaignErr("");
                }}
              >
                Add First-timer
              </button>

              {genMenuOpen ? (
                <div
                  className="absolute right-0 mt-2 w-56 rounded-2xl border bg-white shadow-lg overflow-hidden z-50"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50"
                    onClick={openCreate}
                  >
                    Manual Entry
                  </button>

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
                      setCampaignDays("1000");
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
            <div className="min-w-[1150px] overflow-visible">
              {/* KPI row */}
              <div className="border-b bg-white px-5 py-6">
                <div className="text-xs text-slate-500">
                  Click a card to filter the table.
                </div>

                <div className="mt-2 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
                    onClick={() => setShow("followups")}
                    className={`rounded-2xl border px-4 py-3 text-left transition hover:bg-slate-50 ${
                      show === "followups"
                        ? "bg-primary/15 border-primary"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">
                      Follow-ups
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {kpis.followups}
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

                  <button
                    type="button"
                    onClick={() => setShow("all")}
                    className={`rounded-2xl border px-4 py-3 text-left transition hover:bg-slate-50 ${
                      show === "all"
                        ? "bg-primary/15 border-primary"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">
                      Total
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {kpis.total}
                    </div>
                  </button>
                </div>

                {show === "followups" ? (
                  <div className="mt-5 rounded-2xl border bg-slate-50 px-4 py-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(170px,0.8fr)_minmax(170px,220px)_auto_auto_auto] lg:items-end">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800">
                          Automated follow-up settings
                        </div>

                        <div className="mt-1 max-w-[250px] text-xs leading-5 text-slate-500">
                          Emails are scheduled only when automation is on and
                          the first-timer has an email.
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="mb-1 text-xs font-semibold text-slate-600">
                          Reply-to email
                        </div>

                        <input
                          type="email"
                          title={followupSettings?.default_reply_to ?? ""}
                          className={`w-full min-w-0 rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 ${
                            replyToFocused ? "" : "text-ellipsis"
                          }`}
                          value={followupSettings?.default_reply_to ?? ""}
                          disabled={!isAdmin || savingFollowupSettings}
                          onFocus={(event) => {
                            setReplyToFocused(true);

                            window.requestAnimationFrame(() => {
                              const length = event.currentTarget.value.length;
                              event.currentTarget.setSelectionRange(
                                length,
                                length,
                              );
                              event.currentTarget.scrollLeft =
                                event.currentTarget.scrollWidth;
                            });
                          }}
                          onBlur={() => setReplyToFocused(false)}
                          onChange={(e) =>
                            setFollowupSettings((cur) => ({
                              org_id: orgId ?? "",
                              automation_enabled:
                                cur?.automation_enabled ?? false,
                              timezone_name:
                                cur?.timezone_name ?? "America/New_York",
                              send_time: cur?.send_time ?? "18:00:00",
                              default_reply_to: e.target.value,
                            }))
                          }
                          placeholder="staff@example.com"
                        />
                      </div>

                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => {
                          setFollowupTemplateErr("");
                          setTemplateSettingsOpen(true);
                        }}
                        className="w-full whitespace-nowrap rounded-2xl border bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
                      >
                        Edit email sequence
                      </button>

                      <button
                        type="button"
                        disabled={!isAdmin || savingFollowupSettings}
                        className={`w-full whitespace-nowrap rounded-2xl px-5 py-2 text-sm font-semibold text-white lg:w-auto ${
                          !isAdmin || savingFollowupSettings
                            ? "cursor-not-allowed bg-slate-300"
                            : "bg-slate-900 hover:bg-slate-800"
                        }`}
                        onClick={() =>
                          updateFollowupSettingsPatch({
                            default_reply_to:
                              followupSettings?.default_reply_to?.trim() ||
                              null,
                          })
                        }
                      >
                        {savingFollowupSettings ? "Saving..." : "Save settings"}
                      </button>

                      <button
                        type="button"
                        disabled={!isAdmin || savingFollowupSettings}
                        onClick={() =>
                          updateFollowupSettingsPatch({
                            automation_enabled:
                              !followupSettings?.automation_enabled,
                          })
                        }
                        className={`w-full whitespace-nowrap rounded-2xl border px-5 py-2 text-sm font-semibold lg:w-auto ${
                          followupSettings?.automation_enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "bg-white text-slate-700 hover:bg-slate-50"
                        } ${
                          !isAdmin || savingFollowupSettings
                            ? "cursor-not-allowed opacity-60"
                            : ""
                        }`}
                      >
                        {followupSettings?.automation_enabled
                          ? "Automation on"
                          : "Automation off"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {show === "followups" ? (
                  <div className="mt-4 inline-flex rounded-xl border bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => setFollowupListView("current")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        followupListView === "current"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Current (
                      {
                        scheduledFollowups.filter(
                          (followup) =>
                            !followup.archived_at &&
                            (followup.status === "pending" ||
                              followup.status === "failed" ||
                              followup.status === "blocked_quota"),
                        ).length
                      }
                      )
                    </button>

                    <button
                      type="button"
                      onClick={() => setFollowupListView("history")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        followupListView === "history"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      History (
                      {
                        scheduledFollowups.filter(
                          (followup) =>
                            !followup.archived_at &&
                            (followup.status === "sent" ||
                              followup.status === "cancelled"),
                        ).length
                      }
                      )
                    </button>

                    <button
                      type="button"
                      onClick={() => setFollowupListView("archived")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        followupListView === "archived"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Archived (
                      {
                        scheduledFollowups.filter((followup) =>
                          Boolean(followup.archived_at),
                        ).length
                      }
                      )
                    </button>
                  </div>
                ) : null}

                {show === "followups" && followupListView === "history" ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    History contains sent and cancelled follow-ups. Archive
                    records you no longer need in the main follow-up view.
                  </div>
                ) : null}

                {show === "followups" && followupListView === "archived" ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Archived follow-ups are hidden from Current and History.
                    Unarchive a record to return it to History.
                  </div>
                ) : null}

                <div className="mt-3 text-xs text-slate-500">
                  Showing{" "}
                  <span className="font-semibold">
                    {show === "followups"
                      ? filteredScheduledFollowups.length
                      : filtered.length}
                  </span>{" "}
                  {(show === "followups"
                    ? filteredScheduledFollowups.length
                    : filtered.length) === 1
                    ? "record"
                    : "records"}
                  {q.trim() ? ` matching “${q.trim()}”` : ""}.
                </div>
              </div>

              {/* Header */}
              {/* Header */}
              <div
                className="grid border-b bg-primary px-5 py-4 text-sm font-semibold text-slate-100"
                style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
              >
                {show === "followups" ? (
                  <>
                    <div className="col-span-3">Date</div>
                    <div className="col-span-4">Name</div>
                    <div className="col-span-4">Follow-up</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-4 text-right">Actions</div>
                  </>
                ) : (
                  <>
                    <div className="col-span-4">Name</div>
                    <div className="col-span-3">Contact</div>
                    <div className="col-span-2">First visit</div>
                    <div className="col-span-3">Heard through</div>
                    <div className="col-span-4 text-right">Actions</div>
                  </>
                )}
              </div>

              {loading ? (
                <div className="p-6 text-sm text-slate-600">Loading…</div>
              ) : show === "followups" &&
                filteredScheduledFollowups.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  {q.trim()
                    ? "No scheduled follow-ups match your search."
                    : followupListView === "archived"
                      ? "No archived follow-ups found."
                      : followupListView === "history"
                        ? "No completed or cancelled follow-ups found."
                        : "No current follow-ups found."}
                </div>
              ) : show !== "followups" &&
                filtered.length === 0 &&
                campaigns.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  {q.trim()
                    ? "No first-timers match your search."
                    : "No records found."}
                </div>
              ) : (
                <div className="divide-y">
                  {show === "followups"
                    ? filteredScheduledFollowups.map((f) => {
                        const fullName = `${f.members?.first_name ?? ""} ${
                          f.members?.last_name ?? ""
                        }`.trim();

                        const firstVisit =
                          f.members?.visitor_details?.first_visit_at || "—";

                        return (
                          <div
                            key={f.id}
                            className="grid items-center px-5 py-4 text-sm"
                            style={{
                              gridTemplateColumns: "repeat(16, minmax(0, 1fr))",
                            }}
                          >
                            <div className="col-span-3 text-slate-700">
                              {new Date(f.scheduled_for).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </div>

                            <div className="col-span-4">
                              <div className="font-semibold capitalize">
                                {fullName || "Unnamed first-timer"}
                              </div>
                              <div className="mt-1 truncate text-xs text-slate-500">
                                {f.members?.email || "No email"}
                              </div>
                            </div>

                            <div className="col-span-4">
                              <div className="font-semibold text-slate-800">
                                {f.followup_label}
                              </div>
                              <div className="mt-1 truncate text-xs text-slate-500">
                                {f.subject}
                              </div>
                            </div>

                            <div className="col-span-1">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs ${
                                  f.status === "pending"
                                    ? "bg-slate-50 border-slate-200 text-slate-700"
                                    : f.status === "sent"
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                      : f.status === "blocked_quota"
                                        ? "bg-amber-50 border-amber-200 text-amber-800"
                                        : f.status === "failed"
                                          ? "bg-red-50 border-red-200 text-red-700"
                                          : "bg-slate-50 border-slate-200 text-slate-500"
                                }`}
                              >
                                {f.status.replace("_", " ")}
                              </span>
                            </div>

                            <div className="col-span-4 flex justify-end gap-2">
                              <button
                                className="rounded-xl border px-4 py-1 text-xs hover:bg-slate-50"
                                onClick={() => openScheduledPreview(f)}
                              >
                                Preview
                              </button>

                              {f.archived_at ? (
                                <button
                                  className="rounded-xl border px-4 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={unarchivingScheduledId === f.id}
                                  onClick={() =>
                                    unarchiveScheduledFollowup(f.id)
                                  }
                                >
                                  {unarchivingScheduledId === f.id
                                    ? "Restoring..."
                                    : "Restore"}
                                </button>
                              ) : f.status === "pending" ? (
                                <button
                                  className="rounded-xl border border-red-200 px-4 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                                  disabled={cancellingScheduledId === f.id}
                                  onClick={() => cancelScheduledFollowup(f.id)}
                                >
                                  {cancellingScheduledId === f.id
                                    ? "Cancelling..."
                                    : "Cancel"}
                                </button>
                              ) : followupListView === "history" &&
                                (f.status === "sent" ||
                                  f.status === "cancelled") ? (
                                <button
                                  className="rounded-xl border px-4 py-1 text-xs hover:bg-slate-50"
                                  onClick={() => archiveScheduledFollowup(f.id)}
                                >
                                  Archive
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    : null}

                  {show !== "followups" ? (
                    <>
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

                            <div className="col-span-4 text-slate-700">
                              Multiple visitors
                            </div>
                            <div className="col-span-2 text-slate-700">—</div>
                            <div className="col-span-3 text-slate-700">
                              QR / campaign link
                            </div>

                            <div className="col-span-3 flex justify-end gap-2">
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
                        const firstVisit =
                          r.visitor_details?.first_visit_at || "—";

                        // Only show "View link" when they likely have a link (awaiting form)
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

                            <div className="col-span-3 text-slate-700">
                              <div>{r.phone || "—"}</div>
                              <div className="mt-1 truncate text-xs text-slate-500">
                                {r.email || "—"}
                              </div>
                            </div>

                            <div className="col-span-2 text-slate-700">
                              {firstVisit}
                            </div>

                            <div
                              className="col-span-3 truncate text-slate-700"
                              title={r.visitor_details?.how_heard || ""}
                            >
                              {r.visitor_details?.how_heard || "—"}
                            </div>

                            <div className="col-span-4 flex justify-end gap-2 relative">
                              <button
                                className="rounded-xl border px-5 py-1 text-xs hover:bg-slate-50"
                                onClick={() => openNote(r)}
                              >
                                Notes
                              </button>

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
                                            right:
                                              window.innerWidth - rect.right,
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
                                        className="w-48 rounded-2xl border bg-white shadow-lg z-[9999] overflow-hidden"
                                        onPointerDown={(e) =>
                                          e.stopPropagation()
                                        }
                                      >
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

                                        {isAdmin && r.email ? (
                                          <button
                                            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"
                                            onClick={() => {
                                              setMenu(null);
                                              openFollowUp(r);
                                            }}
                                          >
                                            Send follow-up
                                          </button>
                                        ) : null}

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
                    </>
                  ) : null}
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-2 sm:items-center sm:p-4"
          onClick={() => setFollowUpOpen(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-h-[92vh] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4">
              <div className="text-sm font-semibold">Send follow-up email</div>
              <div className="text-xs text-slate-600">
                Placeholders supported: {"{firstName}"} {"{lastName}"}{" "}
                {"{churchName}"}
              </div>
            </div>

            {followUpErr ? (
              <div className="mx-4 mt-3 shrink-0 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6 sm:mt-4">
                {followUpErr}
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 sm:px-6 sm:py-6">
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
                  className="w-full min-h-[160px] sm:min-h-[220px] rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={followUpBody}
                  onChange={(e) => setFollowUpBody(e.target.value)}
                />
              </div>

              <div className="max-h-48 overflow-y-auto rounded-2xl border bg-slate-50 px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap sm:max-h-60">
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

              {scheduleSendOpen ? (
                <div className="rounded-2xl border bg-slate-50 px-3 py-3 sm:px-4 sm:py-4">
                  <div className="text-sm font-semibold text-slate-800">
                    Schedule send
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Choose when this follow-up email should be sent.
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Send date
                      </div>
                      <input
                        type="date"
                        className="w-full rounded-2xl border bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={scheduleSendDate}
                        onChange={(e) => setScheduleSendDate(e.target.value)}
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Send time
                      </div>
                      <input
                        type="time"
                        className="w-full rounded-2xl border bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={scheduleSendTime}
                        onChange={(e) => setScheduleSendTime(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t px-4 py-3 sm:px-4 sm:py-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  className="w-full rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 sm:w-auto sm:min-w-[96px]"
                  onClick={() => setFollowUpOpen(false)}
                >
                  Cancel
                </button>

                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <button
                    className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 sm:w-auto"
                    onClick={() => setScheduleSendOpen((v) => !v)}
                    disabled={followUpSending || scheduleSendSaving}
                  >
                    {scheduleSendOpen ? "Hide schedule" : "Schedule send"}
                  </button>

                  {scheduleSendOpen ? (
                    <button
                      className={`w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white sm:w-auto sm:min-w-[120px] ${
                        scheduleSendSaving
                          ? "bg-slate-300"
                          : "bg-slate-900 hover:bg-slate-800"
                      }`}
                      disabled={scheduleSendSaving}
                      onClick={scheduleFollowUpEmail}
                    >
                      {scheduleSendSaving ? "Scheduling…" : "Save schedule"}
                    </button>
                  ) : null}

                  <button
                    className={`w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white sm:w-auto sm:min-w-[120px] ${
                      followUpSending
                        ? "bg-slate-300"
                        : "bg-slate-900 hover:bg-slate-800"
                    }`}
                    disabled={followUpSending || scheduleSendSaving}
                    onClick={requestSendFollowUp}
                  >
                    {followUpSending ? "Sending…" : "Send now"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm Limits Modal */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            setConfirmOpen(false);

            if (confirmAction === "scheduled_followup") {
              setPendingScheduledSend(null);
            }

            setConfirmAction(null);
          }}
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
                onClick={() => {
                  setConfirmOpen(false);

                  if (confirmAction === "scheduled_followup") {
                    setPendingScheduledSend(null);
                  }

                  setConfirmAction(null);
                }}
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
                    Home address
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
                      Marital status
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={maritalStatus}
                      onChange={(e) => setMaritalStatus(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Children count
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
                  placeholder="Guest Welcome Link"
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
                  placeholder="1000"
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
                  ? "Link generated"
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

      {/* ========== Automated follow-up sequence settings ========== */}
      {templateSettingsOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-6"
          onMouseDown={() => {
            if (!savingFollowupTemplates) setTemplateSettingsOpen(false);
          }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  Automated email sequence
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Customize when each message is sent and what it says.
                </div>
              </div>
              <button
                type="button"
                className="rounded-xl border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                disabled={savingFollowupTemplates}
                onClick={() => setTemplateSettingsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5 sm:px-6">
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                These templates apply to new first-timers only. Existing
                scheduled follow-ups keep their current date and message. You
                can use {"{firstName}"}, {"{lastName}"}, and {"{churchName}"}.
              </div>

              <div className="mt-4 space-y-4">
                {followupTemplates.map((step, index) => (
                  <div
                    key={step.id ?? `template-${index}`}
                    className="rounded-2xl border bg-slate-50 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="block sm:w-36">
                        <span className="text-xs font-semibold text-slate-600">
                          Send after
                        </span>
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={365}
                            className="w-24 rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                            value={step.day_offset}
                            disabled={!isAdmin || savingFollowupTemplates}
                            onChange={(event) => {
                              const dayOffset = Number(event.target.value);
                              setFollowupTemplates((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, day_offset: dayOffset }
                                    : item,
                                ),
                              );
                            }}
                          />
                          <span className="text-sm text-slate-600">days</span>
                        </div>
                      </label>

                      <label className="block flex-1">
                        <span className="text-xs font-semibold text-slate-600">
                          Step name
                        </span>
                        <input
                          className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                          value={step.label}
                          maxLength={120}
                          disabled={!isAdmin || savingFollowupTemplates}
                          onChange={(event) =>
                            setFollowupTemplates((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, label: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>

                    <label className="mt-3 block">
                      <span className="text-xs font-semibold text-slate-600">
                        Email subject
                      </span>
                      <input
                        className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={step.subject}
                        maxLength={200}
                        disabled={!isAdmin || savingFollowupTemplates}
                        onChange={(event) =>
                          setFollowupTemplates((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, subject: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>

                    <label className="mt-3 block">
                      <span className="text-xs font-semibold text-slate-600">
                        Message
                      </span>
                      <textarea
                        rows={7}
                        className="mt-1 w-full resize-y rounded-xl border bg-white px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-slate-200"
                        value={step.body}
                        maxLength={10000}
                        disabled={!isAdmin || savingFollowupTemplates}
                        onChange={(event) =>
                          setFollowupTemplates((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, body: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>

              {followupTemplateErr ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {followupTemplateErr}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <button
                type="button"
                className="rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={!isAdmin || savingFollowupTemplates}
                onClick={() => {
                  setFollowupTemplates(copyDefaultFollowupSteps());
                  setFollowupTemplateErr("");
                }}
              >
                Restore original defaults
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none"
                  disabled={savingFollowupTemplates}
                  onClick={() => setTemplateSettingsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:flex-none"
                  disabled={!isAdmin || savingFollowupTemplates}
                  onClick={saveFollowupTemplates}
                >
                  {savingFollowupTemplates ? "Saving..." : "Save sequence"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== Modal E: Scheduled follow-up preview ========== */}
      {scheduledPreviewOpen && scheduledPreview ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/30 p-2 sm:items-center sm:p-4"
          onClick={() => {
            setScheduledPreviewOpen(false);
            setScheduledEditMode(false);
            setScheduledEditErr("");
          }}
        >
          <div
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-h-[92vh] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4">
              <div className="text-sm font-semibold">
                Scheduled follow-up preview
              </div>
              <div className="text-xs text-slate-600">
                {scheduledPreview.followup_label}
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">
                    Recipient
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {`${scheduledPreview.members?.first_name ?? ""} ${
                      scheduledPreview.members?.last_name ?? ""
                    }`.trim() || "Unnamed first-timer"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {scheduledPreview.members?.email || "No email"}
                  </div>
                </div>

                <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">
                    Scheduled for
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {new Date(scheduledPreview.scheduled_for).toLocaleString(
                      [],
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      },
                    )}
                  </div>
                  <div className="mt-1 text-xs capitalize text-slate-500">
                    Status: {scheduledPreview.status.replace("_", " ")}
                  </div>
                </div>
              </div>

              {scheduledEditErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {scheduledEditErr}
                </div>
              ) : null}

              {scheduledEditMode ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Send date
                      </div>
                      <input
                        type="date"
                        className="w-full rounded-2xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={scheduledEditDate}
                        onChange={(e) => setScheduledEditDate(e.target.value)}
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        Send time
                      </div>
                      <input
                        type="time"
                        className="w-full rounded-2xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                        value={scheduledEditTime}
                        onChange={(e) => setScheduledEditTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Reply-to
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={scheduledEditReplyTo}
                      onChange={(e) => setScheduledEditReplyTo(e.target.value)}
                      placeholder="staff@example.com"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Subject
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={scheduledEditSubject}
                      onChange={(e) => setScheduledEditSubject(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Body
                    </div>
                    <textarea
                      className="w-full min-h-[180px] rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200 sm:min-h-[240px]"
                      value={scheduledEditBody}
                      onChange={(e) => setScheduledEditBody(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Subject
                    </div>
                    <div className="rounded-2xl border px-4 py-3 text-sm text-slate-800">
                      {scheduledPreview.subject}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Body
                    </div>
                    <div className="max-h-[40vh] min-h-[140px] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border px-4 py-3 text-sm text-slate-800 sm:max-h-72 sm:min-h-[220px]">
                      {scheduledPreview.body}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    Reply-to:{" "}
                    <span className="font-semibold">
                      {scheduledPreview.reply_to || "Not set"}
                    </span>
                  </div>
                </>
              )}

              {scheduledPreview.error_message ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {scheduledPreview.error_message}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t bg-white px-3 py-3 sm:px-4 sm:py-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  className="w-full rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50 sm:w-auto sm:min-w-[96px]"
                  onClick={() => {
                    setScheduledPreviewOpen(false);
                    setScheduledEditMode(false);
                    setScheduledEditErr("");
                  }}
                >
                  Close
                </button>

                {scheduledPreview.status === "pending" &&
                !scheduledPreview.archived_at ? (
                  <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
                    {scheduledEditMode ? (
                      <>
                        <button
                          className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 sm:w-auto"
                          disabled={scheduledEditSaving}
                          onClick={() => {
                            setScheduledEditMode(false);
                            setScheduledEditErr("");
                            setScheduledEditSubject(scheduledPreview.subject);
                            setScheduledEditBody(scheduledPreview.body);
                            setScheduledEditReplyTo(
                              scheduledPreview.reply_to ?? "",
                            );
                            setScheduledEditDate(
                              isoToDateInput(scheduledPreview.scheduled_for),
                            );
                            setScheduledEditTime(
                              isoToTimeInput(scheduledPreview.scheduled_for),
                            );
                          }}
                        >
                          Cancel edit
                        </button>

                        <button
                          className={`w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white sm:w-auto ${
                            scheduledEditSaving
                              ? "bg-slate-300"
                              : "bg-slate-900 hover:bg-slate-800"
                          }`}
                          disabled={scheduledEditSaving}
                          onClick={saveScheduledFollowupEdits}
                        >
                          {scheduledEditSaving ? "Saving..." : "Save changes"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 sm:w-auto"
                          disabled={sendingScheduledId === scheduledPreview.id}
                          onClick={() => setScheduledEditMode(true)}
                        >
                          Edit
                        </button>

                        <button
                          className={`w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white sm:w-auto sm:min-w-[110px] ${
                            sendingScheduledId === scheduledPreview.id
                              ? "bg-slate-300"
                              : "bg-slate-900 hover:bg-slate-800"
                          }`}
                          disabled={sendingScheduledId === scheduledPreview.id}
                          onClick={async () => {
                            setScheduledEditErr("");

                            setPendingScheduledSend(scheduledPreview);

                            setScheduledPreviewOpen(false);
                            setScheduledPreview(null);
                            setScheduledEditMode(false);

                            await requestSend("scheduled_followup", 1);
                          }}
                        >
                          {sendingScheduledId === scheduledPreview.id
                            ? "Sending..."
                            : "Send now"}
                        </button>

                        <button
                          className="w-full rounded-2xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 sm:w-auto"
                          disabled={
                            cancellingScheduledId === scheduledPreview.id
                          }
                          onClick={async () => {
                            await cancelScheduledFollowup(scheduledPreview.id);
                            setScheduledPreviewOpen(false);
                            setScheduledPreview(null);
                          }}
                        >
                          {cancellingScheduledId === scheduledPreview.id
                            ? "Cancelling..."
                            : "Cancel follow-up"}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
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
