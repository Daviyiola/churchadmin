"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getAccessToken, getActiveOrgId } from "@/lib/auth";
import { TipTap, type TipTapHandle } from "@/components/TipTap";

type TabKey = "compose" | "audience" | "preview" | "history";

type Gender = "male" | "female";
type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";
type UploadMode = "inline" | "attachment"; // API allows both, but this page will only use "inline"
type PendingSendAction = "report_send";

type PlanKey = "free" | "basic" | "pro" | "enterprise";

type UploadUiRow = {
  upload_id: string; // message_uploads.id
  filename: string;
  content_type: string;
  bytes: number;
  mode: UploadMode; // always "inline" on this page
  inline_cid?: string;
  storage_path: string;
  bucket: string;
  preview_url?: string;
};

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  gender: Gender | null;
  age_group: AgeGroup | null;
  membership_stage: string | null; // keep loose
};

type MemberDbRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  gender: Gender | null;
  age_group: AgeGroup | null;
  membership_stage: string | null;
};

type HistoryRow = {
  id: string;
  created_at: string;
  subject: string;
  total_recipients: number;
  total_success: number;
};

type HistoryDetailRecipient = {
  email: string;
  success: boolean;
};

type HistoryDetailPayload = {
  subject: string;
  total_recipients: number;
  total_success: number;
  total_failure: number;
  recipients: HistoryDetailRecipient[];
  errors?: string[];
};

type UploadApiOk = {
  ok: true;
  upload: {
    id: string;
    bucket: string;
    path: string;
    filename: string;
    content_type: string;
    bytes: number;
  };
  signed_url: string;
};

type LimitsPayload = {
  ok: true;
  plan: PlanKey;
  month_bucket: string;
  month_limit: number;
  month_used: number;
  month_left: number;
};

type PaymentMethod = "cash" | "cheque" | "online";

type ReportStartBody = {
  organization_id: string;
  subject: string;
  body_html: string;
  reply_to: string;
  uploads: Array<{
    upload_id: string;
    upload_mode: "inline" | "attachment";
    inline_cid?: string;
  }>;
  member_ids: string[];
  start_date: string;
  end_date: string;
  service_ids?: string[];
  category_ids?: string[];
  payment_methods?: PaymentMethod[];
  attach_summary?: boolean;
  attach_detailed?: boolean;
};

type ReportStartOk = {
  ok: true;
  job_id: string;
  campaign_id: string;
  total: number;
};

type JobStatus = "queued" | "running" | "paused" | "done" | "error";

type ReportPumpOk = {
  ok: true;
  status: JobStatus;
  paused_reason?: string | null;
  total: number;
  sent_success: number;
  sent_failure: number;
  processed_now: number;
  done: boolean;
};

type ReportStatusOk = {
  ok: true;
  job: {
    id?: string;
    status?: JobStatus;
    paused_reason?: string | null;
    total?: number;
    sent_success?: number;
    sent_failure?: number;
  };
  recent: Array<{
    to_email?: string;
    success?: boolean;
    error?: string | null;
    created_at?: string;
  }>;
  done: boolean;
};

type RecipientStatus =
  | "pending"
  | "processing"
  | "success"
  | "failure"
  | "skipped";

type RecentRow = {
  idx: number;
  to_email: string;
  display_name: string | null;
  status: RecipientStatus;
  error: string | null;
  sent_at: string | null;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isRecipientStatus(v: unknown): v is RecipientStatus {
  return (
    v === "pending" ||
    v === "processing" ||
    v === "success" ||
    v === "failure" ||
    v === "skipped"
  );
}

function isStatusResponse(v: unknown): v is {
  ok: true;
  job: Record<string, unknown>;
  recent: RecentRow[];
  done: boolean;
  remaining?: number;
} {
  if (!isObject(v)) return false;
  if (v.ok !== true) return false;
  if (!isObject(v.job)) return false;
  if (!Array.isArray(v.recent)) return false;
  if (typeof v.done !== "boolean") return false;

  for (const r of v.recent) {
    if (!isObject(r)) return false;
    if (typeof r.idx !== "number") return false;
    if (typeof r.to_email !== "string") return false;
    if (!(typeof r.display_name === "string" || r.display_name === null))
      return false;
    if (!isRecipientStatus(r.status)) return false;
    if (!(typeof r.error === "string" || r.error === null)) return false;
    if (!(typeof r.sent_at === "string" || r.sent_at === null)) return false;
  }

  if (v.remaining !== undefined && typeof v.remaining !== "number")
    return false;
  return true;
}

function isLimitsPayload(v: unknown): v is LimitsPayload {
  if (!isObject(v)) return false;
  return (
    v.ok === true &&
    (v.plan === "free" ||
      v.plan === "basic" ||
      v.plan === "pro" ||
      v.plan === "enterprise") &&
    typeof v.month_left === "number" &&
    typeof v.month_used === "number" &&
    typeof v.month_limit === "number" &&
    typeof v.month_bucket === "string"
  );
}

function isHistoryDetailPayload(v: unknown): v is HistoryDetailPayload {
  if (!isObject(v)) return false;

  return (
    typeof v.subject === "string" &&
    typeof v.total_recipients === "number" &&
    typeof v.total_success === "number" &&
    typeof v.total_failure === "number" &&
    Array.isArray(v.recipients) &&
    v.recipients.every(
      (r) =>
        isObject(r) &&
        typeof r.email === "string" &&
        typeof r.success === "boolean",
    )
  );
}

function isUploadApiOk(v: unknown): v is UploadApiOk {
  if (!isObject(v)) return false;
  if (v.ok !== true) return false;

  const upload = v.upload;
  if (!isObject(upload)) return false;

  return (
    typeof upload.id === "string" &&
    typeof upload.bucket === "string" &&
    typeof upload.path === "string" &&
    typeof upload.filename === "string" &&
    typeof upload.content_type === "string" &&
    typeof upload.bytes === "number" &&
    typeof v.signed_url === "string"
  );
}

function isReportStartOk(v: unknown): v is ReportStartOk {
  if (!isObject(v)) return false;
  return (
    v.ok === true &&
    typeof v.job_id === "string" &&
    typeof v.campaign_id === "string" &&
    typeof v.total === "number"
  );
}

function isReportPumpOk(v: unknown): v is ReportPumpOk {
  if (!isObject(v)) return false;

  // narrow once
  const obj = v as Record<string, unknown>;

  if (obj.ok !== true) return false;

  if (
    obj.status !== "queued" &&
    obj.status !== "running" &&
    obj.status !== "paused" &&
    obj.status !== "done" &&
    obj.status !== "error"
  ) {
    return false;
  }

  if (
    typeof obj.total !== "number" ||
    typeof obj.sent_success !== "number" ||
    typeof obj.sent_failure !== "number" ||
    typeof obj.processed_now !== "number" ||
    typeof obj.done !== "boolean"
  ) {
    return false;
  }
  if (
    obj.paused_reason !== undefined &&
    obj.paused_reason !== null &&
    typeof obj.paused_reason !== "string"
  ) {
    return false;
  }

  return true;
}



function isReportStatusOk(v: unknown): v is ReportStatusOk {
  if (!isObject(v)) return false;
  if (v.ok !== true) return false;
  if (!isObject(v.job)) return false;
  if (!Array.isArray(v.recent)) return false;
  if (typeof v.done !== "boolean") return false;
  return true;
}

function wrapEmailHtml(innerHtml: string, opts?: { maxWidthPx?: number }) {
  const w = Math.max(320, Math.min(900, opts?.maxWidthPx ?? 600));

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    <center style="width:100%;background:#ffffff;">
      <!--[if mso]>
      <table role="presentation" width="${w}" align="center" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
      <![endif]-->

      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"
        width="100%"
        style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;width:100%;">
        <tr>
          <td align="center" style="padding:24px 12px;">
            <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"
              width="${w}"
              style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;width:${w}px;max-width:${w}px;">
              <tr>
                <td style="padding:0;">
                  ${innerHtml}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!--[if mso]>
          </td>
        </tr>
      </table>
      <![endif]-->
    </center>
  </body>
</html>
  `.trim();
}

function clampEmailImages(html: string, maxWidthPx: number): string {
  return html.replace(
    /<img\b([^>]*?)>/gi,
    (_match: string, attrs: string): string => {
      // Ensure width attribute (helps Gmail + Outlook)
      const hasWidthAttr = /\bwidth\s*=\s*["']/i.test(attrs);
      const attrsWithWidth = hasWidthAttr
        ? attrs
        : `${attrs} width="${maxWidthPx}"`;

      // Ensure responsive inline styles
      const styleRe = /\bstyle\s*=\s*"([^"]*)"/i;

      if (styleRe.test(attrsWithWidth)) {
        return `<img${attrsWithWidth.replace(
          styleRe,
          (_styleMatch: string, styleValue: string): string => {
            const extra = `width:100%;max-width:${maxWidthPx}px;height:auto;display:block;`;

            const nextStyle = `${styleValue};${extra}`.replace(/;;+/g, ";");

            return `style="${nextStyle}"`;
          },
        )}>`;
      }

      return `<img${attrsWithWidth} style="width:100%;max-width:${maxWidthPx}px;height:auto;display:block;">`;
    },
  );
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePreviewHtml(html: string) {
  return html
    .replace(/<p>\s*<\/p>/g, "<p>&nbsp;</p>")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/g, "<p>&nbsp;</p>");
}

function stripOuterHtmlDoc(html: string) {
  return html.replace(/<\/?(html|head|body)[^>]*>/gi, "");
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function isInlineableImage(ct: string) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(ct);
}

function makeCid() {
  return `img_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function isValidEmail(v: string) {
  const s = v.trim().toLowerCase();
  return s.includes("@") && s.length <= 254;
}

function fillVars(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/** Tiny checkbox dropdown (no extra libs) */
function CheckboxDropdown(props: {
  label: string;
  items: Array<{ key: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  myKey: string;
}) {
  const { label, items, selected, onChange, openKey, setOpenKey, myKey } =
    props;
  const open = openKey === myKey;

  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onDocPointerDown(e: PointerEvent) {
      const el = rootRef.current;
      if (!el) return;

      const target = e.target;
      if (target instanceof Node && el.contains(target)) return; // click inside
      setOpenKey(null); // outside click closes
    }

    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open, setOpenKey]);

  function toggle(k: string) {
    const has = selected.includes(k);
    onChange(has ? selected.filter((x) => x !== k) : [...selected, k]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
        onClick={() => setOpenKey(open ? null : myKey)}
      >
        {label}
        {selected.length ? (
          <span className="ml-2 text-xs text-slate-500">
            ({selected.length})
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute z-50 mt-2 w-56 rounded-2xl border bg-white shadow-lg overflow-hidden">
          <div className="max-h-64 overflow-auto p-2">
            {items.map((it) => {
              const checked = selected.includes(it.key);
              return (
                <label
                  key={it.key}
                  className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(it.key)}
                  />
                  <span>{it.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clampYmd(v: string) {
  // Keep user-typed values; just trim
  return v.trim();
}

export default function CommunicationsPage() {
  const orgId = getActiveOrgId();

  const [tab, setTab] = useState<TabKey>("compose");
  const [orgName, setOrgName] = useState("Our Church");

  // Compose
  const [subject, setSubject] = useState("Your Giving Report");

  // Uploads (inline images only)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<UploadUiRow[]>([]);
  const [uploading, setUploading] = useState(false);

  // Audience
  const [memberQ, setMemberQ] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [genderFilter, setGenderFilter] = useState<string[]>([]);
  const [ageFilter, setAgeFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>(["member"]); // reports: default to members

  const [sendMap, setSendMap] = useState<Record<string, boolean>>({}); // memberId -> send?

  // Report filters (required date range)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [serviceIdsCsv, setServiceIdsCsv] = useState<string>(""); // minimal control
  const [categoryIdsCsv, setCategoryIdsCsv] = useState<string>(""); // minimal control
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [attachSummary, setAttachSummary] = useState(true);
  const [attachDetailed, setAttachDetailed] = useState(true);

  // Preview/job sending
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");

  const [jobId, setJobId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [jobTotal, setJobTotal] = useState<number>(0);
  const [sentOk, setSentOk] = useState<number>(0);
  const [sentFail, setSentFail] = useState<number>(0);

  const [recentRows, setRecentRows] = useState<RecentRow[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);

  const [filterOpenKey, setFilterOpenKey] = useState<string | null>(null);

  // History
  const [histQ, setHistQ] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState("");
  const [historyDetail, setHistoryDetail] =
    useState<HistoryDetailPayload | null>(null);
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false);

  const editorRef = useRef<TipTapHandle | null>(null);

  const [replyToEmail, setReplyToEmail] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bodyHtml, setBodyHtml] = useState<string>("");

  // Confirm quota modal (reused)
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

  // Quota modal
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsErr, setLimitsErr] = useState("");
  const [limits, setLimits] = useState<LimitsPayload | null>(null);

  // Non-image upload modal
  const [nonImageOpen, setNonImageOpen] = useState(false);
  const [nonImageName, setNonImageName] = useState<string>("");

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  }

  // Preview vars
  const vars = useMemo(() => ({ churchName: orgName }), [orgName]);

  const hasAnySelected = useMemo(
    () => Object.values(sendMap).some(Boolean),
    [sendMap],
  );

  const previewSubject = useMemo(
    () => fillVars(subject, vars).trim(),
    [subject, vars],
  );

  const previewReplyTo = useMemo(() => {
    const v = replyToEmail.trim();
    return v ? v : "no-reply@mail.churchadmin.app";
  }, [replyToEmail]);

  const previewFromName = orgName;

  const previewHtml = useMemo(() => {
    const raw = stripOuterHtmlDoc(fillVars(bodyHtml, vars));
    return normalizePreviewHtml(raw);
  }, [bodyHtml, vars]);

  const totalUploadBytes = useMemo(
    () => uploads.reduce((s, u) => s + (u.bytes || 0), 0),
    [uploads],
  );

  const selectedMemberIds = useMemo(() => {
    return Object.keys(sendMap).filter((id) => sendMap[id] === true);
  }, [sendMap]);

  const filteredMembers = useMemo(() => {
    const q = memberQ.trim().toLowerCase();

    return members.filter((m) => {
      if (q) {
        const name = `${m.first_name} ${m.last_name ?? ""}`.toLowerCase();
        if (!name.includes(q) && !m.email.includes(q)) return false;
      }

      if (genderFilter.length) {
        if (!m.gender || !genderFilter.includes(m.gender)) return false;
      }
      if (ageFilter.length) {
        if (!m.age_group || !ageFilter.includes(m.age_group)) return false;
      }
      if (stageFilter.length) {
        const st = (m.membership_stage ?? "").toLowerCase();
        const ok =
          (stageFilter.includes("member") && st === "member") ||
          (stageFilter.includes("visitor") && st === "visitor");
        if (!ok) return false;
      }

      return true;
    });
  }, [members, memberQ, genderFilter, ageFilter, stageFilter]);

  const selectedRecipients = useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m]));
    return selectedMemberIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((m) => (m as MemberRow).email);
  }, [members, selectedMemberIds]);

  const progressPct = useMemo(() => {
    if (!jobTotal) return 0;
    const done = sentOk + sentFail;
    return Math.max(0, Math.min(100, Math.round((done / jobTotal) * 100)));
  }, [jobTotal, sentOk, sentFail]);

  const parsedServiceIds = useMemo(() => {
    const raw = serviceIdsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return raw.length ? raw : undefined;
  }, [serviceIdsCsv]);

  const parsedCategoryIds = useMemo(() => {
    const raw = categoryIdsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return raw.length ? raw : undefined;
  }, [categoryIdsCsv]);

  const editorDefaultTemplate = useMemo(() => {
    return `
    
    <p>
      Greetings, 
    </p><br/>

    <p>
      On behalf of the leadership of our Church, thank you for your
      continued faithfulness and generosity. Your support during the selected
      period has played an important role in helping us carry out the mission
      and work of the church. We are deeply grateful for your willingness to give. Through your
      contributions, lives are being touched, needs are being met, and the
      work of ministry continues both within our local community and beyond.
    </p><br/>

    <p>
      Attached to this email, you will find your giving report PDF(s) for the
      selected period. Please retain these documents for your personal records. 
      If you have any questions or notice any discrepancies, feel free to reply
      to this email and we will be happy to assist you.
    </p><br/>

    <p>
      With sincere thanks and blessings,<br/>
      <strong>${escapeHtml(orgName)}</strong>
    </p>
  `;
  }, [orgName]);

  /** -------- load org name -------- */
  useEffect(() => {
    if (!orgId) return;

    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      if (org?.name) setOrgName(org.name);
    })();
  }, [orgId]);

  /** -------- set starter email body when orgName known -------- */
  useEffect(() => {
    if (!orgName) return;
    setBodyHtml((cur) => (cur.trim() ? cur : editorDefaultTemplate));
  }, [orgName, editorDefaultTemplate]);

  /** -------- members load -------- */
  const loadMembers = useCallback(async () => {
    if (!orgId) return;
    setMembersLoading(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .select(
          "id,first_name,last_name,email,gender,age_group,membership_stage",
        )
        .eq("org_id", orgId)
        .eq("status", "active")
        .not("email", "is", null)
        .order("last_name", { ascending: true });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as MemberDbRow[];
      const normalized: MemberRow[] = rows
        .map((r) => ({
          id: r.id,
          first_name: r.first_name ?? "",
          last_name: r.last_name,
          email: String(r.email ?? "").toLowerCase(),
          gender: r.gender,
          age_group: r.age_group,
          membership_stage: r.membership_stage,
        }))
        .filter((m) => isValidEmail(m.email));

      setMembers(normalized);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load members");
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (tab === "audience") loadMembers();
  }, [tab, loadMembers]);

  /** -------- uploads: inline images only -------- */
  async function handleUploadFiles(files: FileList | null) {
    if (!orgId) return;
    if (!files || files.length === 0) return;

    const maxFiles = 10;
    const maxTotal = 20 * 1024 * 1024; // 20MB
    const selected = Array.from(files).slice(0, maxFiles);

    // block non-image *before* upload (attachments are not allowed on this page)
    const firstNonImage = selected.find((f) => {
      // browser may provide empty type, so also check extension
      const t = (f.type || "").toLowerCase();
      if (t && t.startsWith("image/")) return false;
      const name = f.name.toLowerCase();
      return !(
        name.endsWith(".png") ||
        name.endsWith(".jpg") ||
        name.endsWith(".jpeg") ||
        name.endsWith(".webp") ||
        name.endsWith(".gif")
      );
    });

    if (firstNonImage) {
      setNonImageName(firstNonImage.name);
      setNonImageOpen(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const selectedBytes = selected.reduce((s, f) => s + f.size, 0);
    if (selectedBytes + totalUploadBytes > maxTotal) {
      showToast("Too large (keep uploads under 20MB)");
      return;
    }

    setUploading(true);
    try {
      const token = await getAccessToken();

      for (const file of selected) {
        const fd = new FormData();
        fd.append("organization_id", orgId);
        fd.append("file", file);

        const res = await fetch("/api/communications/upload", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: fd,
        });

        const json: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          const errMsg =
            isObject(json) && typeof json.error === "string"
              ? json.error
              : "Upload failed";
          throw new Error(errMsg);
        }

        if (!isUploadApiOk(json)) {
          throw new Error("Upload failed: unexpected response shape");
        }

        const { upload, signed_url } = json;

        // Enforce inline-only (and must be image)
        if (!isInlineableImage(upload.content_type)) {
          // Should not happen because we blocked by File, but keep safe
          setNonImageName(upload.filename);
          setNonImageOpen(true);
          continue;
        }

        const inline_cid = makeCid();

        setUploads((cur) => [
          ...cur,
          {
            upload_id: upload.id,
            bucket: upload.bucket,
            storage_path: upload.path,
            filename: upload.filename,
            content_type: upload.content_type,
            bytes: upload.bytes,
            mode: "inline",
            inline_cid,
            preview_url: signed_url,
          },
        ]);

        editorRef.current?.insertImage({
          src: signed_url,
          alt: upload.filename,
          uploadId: upload.id,
          align: "center",
        });
      }

      showToast("Uploaded ✓");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeUpload(upload_id: string) {
    setUploads((cur) => cur.filter((u) => u.upload_id !== upload_id));
    editorRef.current?.removeImagesByUploadId(upload_id);
  }

  /** -------- quota helpers -------- */
  async function fetchMonthlyLimits(
    organizationId: string,
    jwt: string,
  ): Promise<LimitsPayload> {
    const res = await fetch(
      `/api/communications/limits?organization_id=${encodeURIComponent(
        organizationId,
      )}`,
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
        isObject(parsed) &&
        typeof parsed.error === "string" &&
        parsed.error.trim().length
          ? parsed.error
          : "Failed to load limits";
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

      const lim = await fetchMonthlyLimits(orgId, jwt);

      setConfirmAction(action);
      setConfirmCount(count);
      setConfirmPlan(lim.plan);
      setConfirmLeftBefore(lim.month_left);

      if (lim.month_left < count) setInsufficient(true);
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

    if (confirmAction === "report_send") {
      await startReportJob();
    }
  }

  async function openLimitsModal() {
    if (!orgId) return;
    setLimitsErr("");
    setLimits(null);
    setLimitsOpen(true);
    setLimitsLoading(true);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const lim = await fetchMonthlyLimits(orgId, jwt);
      setLimits(lim);
    } catch (e) {
      setLimitsErr(e instanceof Error ? e.message : "Failed to load limits");
    } finally {
      setLimitsLoading(false);
    }
  }

  /** -------- report email job: start/pump/status -------- */
  async function startReportJob() {
    setSendErr("");
    if (!orgId) return;

    const memberIds = selectedMemberIds;
    if (memberIds.length === 0) {
      setSendErr("Select at least one recipient in Audience.");
      return;
    }

    const subj = previewSubject;
    const w = 600;
    const bod = previewHtml.trim();
    const safe = clampEmailImages(bod, w);

    if (!subj) {
      setSendErr("Subject required");
      return;
    }
    if (!bod) {
      setSendErr("Body required");
      return;
    }

    const sd = clampYmd(startDate);
    const ed = clampYmd(endDate);
    if (!sd || !ed) {
      setSendErr("Start date and end date are required.");
      return;
    }

    // reset job state
    setSending(true);
    setJobId(null);
    setCampaignId(null);
    setJobStatus("queued");
    setPausedReason(null);
    setJobTotal(memberIds.length);
    setSentOk(0);
    setSentFail(0);
    setRecentRows([]);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const body: ReportStartBody = {
        organization_id: orgId,
        subject: subj,
        body_html: wrapEmailHtml(safe, { maxWidthPx: w }),
        reply_to: previewReplyTo,
        uploads: uploads
          .filter((u) => u.mode === "inline" && !!u.inline_cid)
          .map((u) => ({
            upload_id: u.upload_id,
            upload_mode: "inline",
            inline_cid: u.inline_cid,
          })),
        member_ids: memberIds,
        start_date: sd,
        end_date: ed,
        service_ids: parsedServiceIds,
        category_ids: parsedCategoryIds,
        payment_methods: paymentMethods.length ? paymentMethods : undefined,
        attach_summary: attachSummary,
        attach_detailed: attachDetailed,
      };

      const res = await fetch("/api/reports/email-member-giving/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      });

      const json: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          isObject(json) && typeof json.error === "string"
            ? json.error
            : "Failed to start report job";
        throw new Error(msg);
      }

      if (!isReportStartOk(json)) {
        throw new Error(
          "Failed to start report job: unexpected response shape",
        );
      }

      setJobId(json.job_id);
      setCampaignId(json.campaign_id);
      setJobTotal(json.total);
      setJobStatus("running");

      // kick an immediate pump so user sees movement quickly
      await pumpOnce(json.job_id);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Failed to start sending");
      setSending(false);
      setJobStatus("error");
    }
  }

  async function readJsonOrThrow(res: Response) {
    const text = await res.text(); // always read raw first

    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `Non-JSON response (${res.status}). ` +
          `First 200 chars: ${text.slice(0, 200)}`,
      );
    }

    return { parsed, text };
  }

  async function pumpOnce(job_id: string) {
    if (!orgId) return;

    const { data: sessionRes } = await supabase.auth.getSession();
    const jwt = sessionRes.session?.access_token;
    if (!jwt) throw new Error("Unauthorized");

    const res = await fetch("/api/reports/email-member-giving/pump", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        organization_id: orgId,
        job_id,
        batch_size: 3,
      }),
    });

    const { parsed, text } = await readJsonOrThrow(res);

    // If server returned an error (400/403/etc), show its message
    if (!res.ok) {
      const msg =
        isObject(parsed) && typeof parsed.error === "string"
          ? parsed.error
          : `Pump failed (${res.status}). Body: ${text.slice(0, 200)}`;
      throw new Error(msg);
    }

    // Success must match ReportPumpOk
    if (!isReportPumpOk(parsed)) {
      throw new Error(
        `Pump failed: unexpected response shape. Body: ${text.slice(0, 200)}`,
      );
    }

    setJobStatus(parsed.status);
    setPausedReason(parsed.paused_reason ?? null);
    setJobTotal(parsed.total);
    setSentOk(parsed.sent_success);
    setSentFail(parsed.sent_failure);

    await refreshStatus(job_id);
  }

  const jobStatusRef = useRef<JobStatus | null>(null);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    jobStatusRef.current = jobStatus;
  }, [jobStatus]);
  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  async function refreshStatus(job_id: string) {
    if (!orgId) return;

    const { data: sessionRes } = await supabase.auth.getSession();
    const jwt = sessionRes.session?.access_token;
    if (!jwt) throw new Error("Unauthorized");

    const res = await fetch(
      `/api/reports/email-member-giving/status?organization_id=${encodeURIComponent(
        orgId,
      )}&job_id=${encodeURIComponent(job_id)}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );

    const { parsed, text } = await readJsonOrThrow(res);

    if (!res.ok) {
      const msg =
        isObject(parsed) && typeof parsed.error === "string"
          ? parsed.error
          : `Status failed (${res.status}). Body: ${text.slice(0, 200)}`;
      throw new Error(msg);
    }

    if (!isStatusResponse(parsed)) {
      // don’t crash UI, but don’t silently swallow either
      console.warn("Status unexpected shape:", parsed);
      return;
    }

    const json = parsed;

    if (!isStatusResponse(json)) return;

    if (typeof json.job.status === "string")
      setJobStatus(json.job.status as JobStatus);
    if (typeof json.job.paused_reason === "string")
      setPausedReason(json.job.paused_reason);
    else if (json.job.paused_reason === null) setPausedReason(null);

    if (typeof json.job.total === "number") setJobTotal(json.job.total);
    if (typeof json.job.sent_success === "number")
      setSentOk(json.job.sent_success);
    if (typeof json.job.sent_failure === "number")
      setSentFail(json.job.sent_failure);

    setRecentRows(json.recent);
    setRemaining(typeof json.remaining === "number" ? json.remaining : null);

    if (json.done) setJobStatus("done");
  }

  // auto-pump loop while running
  useEffect(() => {
    if (!orgId || !sending || !jobId) return;

    let alive = true;
    let timer: number | null = null;

    async function tick() {
      try {
        if (!alive) return;

        const st = jobStatusRef.current;
        const id = jobIdRef.current;

        if (!id) return;
        if (st === "paused" || st === "done" || st === "error") return;

        await pumpOnce(id);
      } catch (e) {
        setSendErr(e instanceof Error ? e.message : "Sending error");
        setJobStatus("error");
      } finally {
        if (!alive) return;

        const st = jobStatusRef.current;
        const shouldContinue =
          st !== "paused" && st !== "done" && st !== "error";
        if (shouldContinue) timer = window.setTimeout(tick, 1400);
      }
    }

    timer = window.setTimeout(tick, 900);
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [orgId, sending, jobId]);

  // when job finishes, wrap up and push to history tab
  useEffect(() => {
    if (!sending) return;
    if (!jobId) return;

    const done = jobStatus === "done";
    if (!done) return;

    (async () => {
      setSending(false);
      showToast(`Done ✓ (${sentOk} ok, ${sentFail} failed)`);

      // Refresh history and jump there
      await loadHistory();
      setTab("history");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus, sending, jobId]);

  async function resumeJob() {
    if (!jobId) return;
    setSendErr("");
    setPausedReason(null);
    setJobStatus("running");
    try {
      await pumpOnce(jobId);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Failed to resume");
      setJobStatus("error");
    }
  }

  /** -------- history (reused) -------- */
  async function loadHistory() {
    if (!orgId) return;
    setHistoryErr("");
    setHistoryLoading(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const res = await fetch(
        `/api/communications/history/list?organization_id=${encodeURIComponent(
          orgId,
        )}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );

      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(String(json?.error ?? "Failed to load history"));

      setHistory((json?.rows ?? []) as HistoryRow[]);
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : "Failed to load history");
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, orgId]);

  const filteredHistory = useMemo(() => {
    const q = histQ.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => (h.subject ?? "").toLowerCase().includes(q));
  }, [history, histQ]);

  async function openHistoryDetail(campaignId: string) {
    if (!orgId) return;

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const res = await fetch(
        `/api/communications/history/detail?organization_id=${encodeURIComponent(
          orgId,
        )}&campaign_id=${encodeURIComponent(campaignId)}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );

      const text = await res.text();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON response");
      }

      if (!res.ok) {
        if (isObject(parsed) && typeof parsed.error === "string") {
          throw new Error(parsed.error);
        }
        throw new Error("Failed to load detail");
      }

      if (!isHistoryDetailPayload(parsed)) {
        throw new Error("Bad response");
      }

      setHistoryDetail(parsed);
      setHistoryDetailOpen(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load detail");
    }
  }

  return (
    <>
      {/* Header + tab stubs */}
      <div className="border-b">
        <div className="px-6 py-4 mt-7">
          <div className="text-xl font-semibold">
            Email Member Giving Reports
          </div>
          <div className="text-sm text-slate-600">
            Send giving report PDFs to selected members. Inline images in the
            email body are supported.
          </div>

          <div className="mt-4 inline-flex rounded-2xl border bg-slate-50 p-1">
            {(
              [
                ["compose", "Compose"],
                ["audience", "Audience"],
                ["preview", "Preview"],
                ["history", "History"],
              ] as Array<[TabKey, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === k
                    ? "bg-white border shadow-sm"
                    : "text-slate-600 hover:bg-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* tiny job badge (optional, minimal) */}
          {jobId ? (
            <div className="mt-3 text-xs text-slate-500">
              Job: <span className="font-semibold">{jobId.slice(0, 8)}</span>
              {campaignId ? (
                <>
                  {" "}
                  • Campaign:{" "}
                  <span className="font-semibold">
                    {campaignId.slice(0, 8)}
                  </span>
                </>
              ) : null}
              {jobStatus ? (
                <>
                  {" "}
                  • Status: <span className="font-semibold">{jobStatus}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        {/* COMPOSE */}
        {tab === "compose" ? (
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-6 py-4">
              <div className="text-lg font-semibold">Compose Email</div>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* Report Filters */}
              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Report filters</div>
                    <div className="text-xs text-slate-600 mt-1">
                      Date range is required. blank.
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attachSummary}
                        onChange={(e) => setAttachSummary(e.target.checked)}
                      />
                      <span>Attach Summary report (PDF)</span>
                    </label>

                    <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attachDetailed}
                        onChange={(e) => setAttachDetailed(e.target.checked)}
                      />
                      <span>Attach Detailed report (PDF)</span>
                    </label>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Start date *
                    </div>
                    <input
                      type="date"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      End date *
                    </div>
                    <input
                      type="date"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                {/* <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Service IDs (optional)
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      placeholder="comma-separated UUIDs"
                      value={serviceIdsCsv}
                      onChange={(e) => setServiceIdsCsv(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-600">
                      Category IDs (optional)
                    </div>
                    <input
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      placeholder="comma-separated UUIDs"
                      value={categoryIdsCsv}
                      onChange={(e) => setCategoryIdsCsv(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <CheckboxDropdown
                    myKey="pay"
                    openKey={filterOpenKey}
                    setOpenKey={setFilterOpenKey}
                    label="Payment methods"
                    items={[
                      { key: "cash", label: "Cash" },
                      { key: "cheque", label: "Cheque" },
                      { key: "online", label: "Online" },
                    ]}
                    selected={paymentMethods}
                    onChange={(next) =>
                      setPaymentMethods(next as PaymentMethod[])
                    }
                  />

                  {paymentMethods.length ? (
                    <div className="text-xs text-slate-600">
                      Selected:{" "}
                      <span className="font-semibold">
                        {paymentMethods.join(", ")}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      No payment method filter
                    </div>
                  )}
                </div> */}
              </div>

              <div>
                <div className="mb-1 text-lg font-semibold text-slate-600">
                  Subject *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-1 text-lg font-semibold text-slate-600">
                  Body *
                </div>

                <TipTap
                  ref={editorRef}
                  valueHtml={bodyHtml}
                  onChangeHtml={setBodyHtml}
                />
              </div>

              {/* Uploads */}
              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Inline images</div>
                    <div className="text-xs text-slate-600 mt-1">
                      Only images can be uploaded here (PNG/JPG/WebP/GIF) · Max
                      ≤ 20 MB
                    </div>
                  </div>

                  <div className="shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadFiles(e.target.files)}
                    />
                    <button
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                        uploading
                          ? "bg-slate-300"
                          : "bg-slate-900 hover:bg-slate-800"
                      }`}
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? "Uploading…" : "Upload"}
                    </button>
                  </div>
                </div>

                {uploads.length ? (
                  <div className="mt-4 space-y-2">
                    {uploads.map((u) => (
                      <div
                        key={u.upload_id}
                        className="flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {u.filename}
                          </div>
                          <div className="text-xs text-slate-600">
                            {u.content_type} • {formatBytes(u.bytes)}
                            {u.inline_cid ? ` • cid:${u.inline_cid}` : ""}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-slate-500">Inline</span>
                          <button
                            className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                            onClick={() => removeUpload(u.upload_id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="text-xs text-slate-600 mt-2">
                      Total uploads:{" "}
                      <span className="font-semibold">
                        {formatBytes(totalUploadBytes)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-slate-600">
                    No images yet.
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  className="rounded-2xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/85"
                  onClick={() => setTab("audience")}
                >
                  Audience
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* AUDIENCE */}
        {tab === "audience" ? (
          <div className="rounded-3xl border bg-white overflow-hidden">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Audience</div>
              <div className="text-xs text-slate-600">
                Active members with email only.
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                  className="w-full sm:w-96 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="Search name or email…"
                  value={memberQ}
                  onChange={(e) => setMemberQ(e.target.value)}
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                    onClick={() => {
                      if (!hasAnySelected) {
                        const next: Record<string, boolean> = {};
                        for (const m of filteredMembers) {
                          next[m.id] = true;
                        }
                        setSendMap(next);
                      } else {
                        setGenderFilter([]);
                        setAgeFilter([]);
                        setStageFilter(["member"]); // keep reports default
                        setFilterOpenKey(null);
                        setSendMap({});
                      }
                    }}
                  >
                    {hasAnySelected ? "Clear all" : "Select all"}
                  </button>

                  <CheckboxDropdown
                    myKey="gender"
                    openKey={filterOpenKey}
                    setOpenKey={setFilterOpenKey}
                    label="Gender"
                    items={[
                      { key: "male", label: "Male" },
                      { key: "female", label: "Female" },
                    ]}
                    selected={genderFilter}
                    onChange={setGenderFilter}
                  />

                  <CheckboxDropdown
                    myKey="age"
                    openKey={filterOpenKey}
                    setOpenKey={setFilterOpenKey}
                    label="Age group"
                    items={[
                      { key: "1-12", label: "1–12" },
                      { key: "13-17", label: "13–17" },
                      { key: "18-35", label: "18–35" },
                      { key: "36+", label: "36+" },
                    ]}
                    selected={ageFilter}
                    onChange={setAgeFilter}
                  />

                  {/* kept for UI continuity; default is member */}
                  <CheckboxDropdown
                    myKey="stage"
                    openKey={filterOpenKey}
                    setOpenKey={setFilterOpenKey}
                    label="Stage"
                    items={[
                      { key: "visitor", label: "Visitor" },
                      { key: "member", label: "Member" },
                    ]}
                    selected={stageFilter}
                    onChange={setStageFilter}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 text-xs text-slate-500 flex items-center justify-between">
              <div>
                Showing{" "}
                <span className="font-semibold text-slate-700">
                  {filteredMembers.length}
                </span>
              </div>
              <div>
                Selected to send:{" "}
                <span className="font-semibold text-slate-700">
                  {selectedMemberIds.length}
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="border-t">
              <div
                className="grid bg-slate-50 px-6 py-3 text-xs font-semibold text-slate-600"
                style={{ gridTemplateColumns: "2fr 2fr 120px" }}
              >
                <div>Name</div>
                <div>Email</div>
                <div className="text-right">Send</div>
              </div>

              {membersLoading ? (
                <div className="px-6 py-6 text-sm text-slate-600">Loading…</div>
              ) : filteredMembers.length === 0 ? (
                <div className="px-6 py-6 text-sm text-slate-600">
                  No matches.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredMembers.map((m) => {
                    const name = `${m.first_name} ${m.last_name ?? ""}`.trim();
                    const send = sendMap[m.id] === true;

                    return (
                      <div
                        key={m.id}
                        className="grid items-center px-6 py-4 text-sm"
                        style={{ gridTemplateColumns: "2fr 2fr 120px" }}
                      >
                        <div className="font-semibold capitalize">
                          {name || "—"}
                        </div>
                        <div className="text-slate-700">{m.email}</div>

                        <div className="flex justify-end">
                          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={send}
                              onChange={() =>
                                setSendMap((cur) => ({ ...cur, [m.id]: !send }))
                              }
                            />
                            <span>{send ? "Will send" : "Skip"}</span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t px-6 py-4 flex justify-end">
              <button
                className="rounded-2xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/85"
                onClick={() => setTab("preview")}
              >
                Preview
              </button>
            </div>
          </div>
        ) : null}

        {/* PREVIEW */}
        {tab === "preview" ? (
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Preview & Send</div>
              <div className="text-xs text-slate-600">
                Sends are job-based with progress tracking.
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              {sendErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {sendErr}
                </div>
              ) : null}

              <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Reply-to
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. pastor@yourchurch.org"
                    value={replyToEmail}
                    onChange={(e) => setReplyToEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Progress + pause state */}
              {sending || jobId ? (
                <div className="rounded-2xl border p-4">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      {jobStatus === "paused"
                        ? "Paused"
                        : jobStatus === "done"
                          ? "Done"
                          : "Sending…"}
                    </span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-2 bg-primary"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  <div className="mt-3 text-xs text-slate-600">
                    Success: <span className="font-semibold">{sentOk}</span> •
                    Failed: <span className="font-semibold">{sentFail}</span> •
                    Total: <span className="font-semibold">{jobTotal}</span>
                  </div>

                  {jobStatus === "paused" ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="font-semibold">Sending paused</div>
                      <div className="mt-1 text-xs text-amber-800">
                        {pausedReason ?? "Quota or burst limit hit."}
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                          onClick={resumeJob}
                        >
                          Resume
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {recentRows.length ? (
                    <div className="mt-4 rounded-2xl border overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 flex items-center justify-between gap-3">
                        <span>Recent activity</span>

                        {/* Optional: show remaining if you store it from /status */}
                        {typeof remaining === "number" ? (
                          <span className="text-[11px] font-semibold text-slate-500">
                            Remaining: {remaining}
                          </span>
                        ) : null}
                      </div>

                      <div className="max-h-[180px] overflow-auto divide-y">
                        {recentRows.slice(0, 12).map((r, idx) => {
                          const status = r.status ?? "pending";

                          const pill =
                            status === "success" ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                                Success
                              </span>
                            ) : status === "failure" ? (
                              <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                                Failed
                              </span>
                            ) : status === "skipped" ? (
                              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                                Skipped
                              </span>
                            ) : status === "processing" ? (
                              <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                                Sending…
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                Pending
                              </span>
                            );

                          const showError =
                            (status === "failure" || status === "skipped") &&
                            !!r.error;

                          return (
                            <div
                              key={`${r.to_email ?? "row"}-${idx}`}
                              className="px-4 py-2 text-xs flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0 truncate text-slate-700">
                                {r.to_email ?? "—"}
                              </div>

                              <div className="shrink-0">{pill}</div>

                              {showError ? (
                                <div
                                  className="mt-1 text-[11px] text-red-700 truncate"
                                  title={r.error ?? ""}
                                >
                                  {r.error}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-3xl border bg-white overflow-hidden">
                <div className="border-b bg-slate-50 px-6 py-4">
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-slate-600">Subject</div>
                      <div className="text-sm font-semibold">
                        {previewSubject}
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-6 text-sm">
                      <div className="text-slate-700">
                        Selected recipients:{" "}
                        <span className="font-semibold text-slate-900">
                          {selectedRecipients.length}
                        </span>
                      </div>

                      <div className="text-slate-700">
                        Inline images:{" "}
                        <span className="font-semibold text-slate-900">
                          {uploads.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-slate-600">From</div>
                      <div className="text-sm">
                        <span className="font-semibold">{previewFromName}</span>{" "}
                        <span className="text-slate-500">
                          &lt;noreply@mail.churchadmin.com&gt;
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-600">Reply-to</div>
                      <div className="text-sm">{previewReplyTo}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-slate-600">Report range</div>
                      <div className="text-sm">
                        <span className="font-semibold">
                          {startDate || "—"} → {endDate || "—"}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-600">
                        PDF attachments
                      </div>
                      <div className="text-sm">
                        <span className="font-semibold">
                          {attachSummary ? "Summary" : ""}
                          {attachSummary && attachDetailed ? " + " : ""}
                          {attachDetailed ? "Detailed" : ""}
                          {!attachSummary && !attachDetailed ? "None" : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-6">
                  {logoUrl ? (
                    <div className="mb-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logoUrl} alt="logo" className="h-10 w-auto" />
                    </div>
                  ) : null}

                  <style jsx global>{`
                    .emailPreview {
                      max-width: 600px;
                      margin: 0 auto;
                    }
                    .emailPreview ul {
                      list-style: disc !important;
                      padding-left: 24px !important;
                      margin: 12px 0 !important;
                    }
                    .emailPreview ol {
                      list-style: decimal !important;
                      padding-left: 24px !important;
                      margin: 12px 0 !important;
                    }
                    .emailPreview a {
                      color: #2563eb !important;
                      text-decoration: underline !important;
                      text-underline-offset: 2px !important;
                    }
                  `}</style>

                  <div
                    className="emailPreview rounded-2xl border bg-white p-4 text-sm"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  className="rounded-2xl border px-5 py-2 text-sm hover:bg-slate-50"
                  onClick={() => setTab("audience")}
                >
                  Audience
                </button>

                <button
                  className="rounded-2xl border px-5 py-2 text-sm hover:bg-slate-50"
                  onClick={openLimitsModal}
                >
                  Emails left
                </button>

                <div className="flex gap-2">
                  <button
                    className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${
                      sending
                        ? "bg-slate-300"
                        : "bg-primary hover:bg-primary/85"
                    }`}
                    disabled={sending}
                    onClick={() =>
                      requestSend("report_send", selectedMemberIds.length)
                    }
                  >
                    Send reports
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* HISTORY */}
        {tab === "history" ? (
          <div className="rounded-3xl border bg-white overflow-hidden">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">History</div>
              <div className="text-xs text-slate-600">
                Previous campaigns and results.
              </div>

              <div className="mt-4">
                <input
                  className="w-full sm:w-96 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="Search subject…"
                  value={histQ}
                  onChange={(e) => setHistQ(e.target.value)}
                />
              </div>
            </div>

            {historyErr ? (
              <div className="px-6 py-4 text-sm text-red-700">{historyErr}</div>
            ) : null}

            <div className="border-t">
              <div
                className="grid bg-slate-50 px-6 py-3 text-xs font-semibold text-slate-600"
                style={{ gridTemplateColumns: "160px 2fr 180px 160px" }}
              >
                <div>Date</div>
                <div>Subject</div>
                <div className="text-right">Total recipients</div>
                <div className="text-right">Total success</div>
              </div>

              {historyLoading ? (
                <div className="px-6 py-6 text-sm text-slate-600">Loading…</div>
              ) : filteredHistory.length === 0 ? (
                <div className="px-6 py-6 text-sm text-slate-600">
                  No history yet.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredHistory.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="w-full text-left grid items-center px-6 py-4 text-sm hover:bg-slate-50"
                      style={{ gridTemplateColumns: "160px 2fr 180px 160px" }}
                      onClick={() => openHistoryDetail(h.id)}
                    >
                      <div className="text-slate-700">
                        {new Date(h.created_at).toLocaleDateString()}
                      </div>
                      <div className="font-semibold truncate">{h.subject}</div>
                      <div className="text-right text-slate-700">
                        {h.total_recipients}
                      </div>
                      <div className="text-right text-slate-700">
                        {h.total_success}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Non-image upload modal */}
      {nonImageOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setNonImageOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                Only images allowed here
              </div>
              <div className="text-xs text-slate-600">
                This page can only upload inline images for the email body.
              </div>
            </div>

            <div className="px-6 py-6 space-y-3">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-semibold">Unsupported file</div>
                <div className="mt-1 text-xs text-amber-800">
                  <span className="font-semibold">
                    {nonImageName || "That file"}
                  </span>{" "}
                  isn&apos;t an image. If you need to attach files, please use
                  Email Broadcast mode instead.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => setNonImageOpen(false)}
              >
                Got it
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
                      Sorry, you don&apos;t have enough emails left to send
                      these reports.
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

      {/* Email Limits Modal*/}
      {limitsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setLimitsOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Monthly email quota</div>
                <div className="text-xs text-slate-600">
                  Remaining sends for this organization.
                </div>
              </div>
              <button
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
                onClick={() => setLimitsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="px-6 py-6 space-y-4">
              {limitsErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {limitsErr}
                </div>
              ) : null}

              {limitsLoading ? (
                <div className="text-sm text-slate-600">Loading…</div>
              ) : limits ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold text-slate-600">
                        Plan
                      </div>
                      <div className="mt-1 text-lg font-semibold capitalize">
                        {limits.plan}
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold text-slate-600">
                        Emails left this month
                      </div>
                      <div className="mt-1 text-2xl font-semibold">
                        {limits.month_left}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Used {limits.month_used} / {limits.month_limit}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500">
                    Month bucket: {limits.month_bucket}
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-600">No data.</div>
              )}
            </div>

            <div className="border-t px-6 py-4 flex justify-end">
              <button
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => setLimitsOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* History detail modal */}
      {historyDetailOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setHistoryDetailOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Broadcast details</div>
                <div className="text-xs text-slate-600">
                  {historyDetail?.subject ?? "—"}
                </div>
              </div>
              <button
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
                onClick={() => setHistoryDetailOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">
                    Total recipients
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {historyDetail?.total_recipients ?? 0}
                  </div>
                </div>

                <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">
                    Success
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {historyDetail?.total_success ?? 0}
                  </div>
                </div>

                <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">
                    Failed
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {historyDetail?.total_failure ?? 0}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border overflow-hidden">
                <div
                  className="grid bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600"
                  style={{ gridTemplateColumns: "2fr 120px" }}
                >
                  <div>Email</div>
                  <div className="text-right">Status</div>
                </div>

                <div className="max-h-[360px] overflow-auto divide-y">
                  {(historyDetail?.recipients ?? []).length === 0 ? (
                    <div className="px-4 py-4 text-sm text-slate-600">
                      No recipient rows found.
                    </div>
                  ) : (
                    (historyDetail?.recipients ?? []).map((r, idx) => (
                      <div
                        key={`${r.email ?? "row"}-${idx}`}
                        className="grid items-center px-4 py-3 text-sm"
                        style={{ gridTemplateColumns: "2fr 120px" }}
                      >
                        <div className="text-slate-800">
                          {String(r.email ?? "—")}
                        </div>
                        <div className="text-right">
                          {r.success ? (
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                              Success
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                              Failed
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {historyDetail?.errors?.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <div className="font-semibold mb-1">Some errors</div>
                  <ul className="list-disc pl-5 space-y-1">
                    {historyDetail.errors.slice(0, 8).map((e, i) => (
                      <li key={`${i}-${e}`}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div className="fixed top-6 right-6 z-[99999]">
          <div className="rounded-2xl bg-slate-50 text-black px-4 py-3 text-sm shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}
    </>
  );
}
