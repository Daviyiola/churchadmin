"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { getAccessToken, getActiveOrgId } from "@/lib/auth";
import { TipTap, type TipTapHandle } from "@/components/TipTap";
import {
  RecipientPicker,
  type RecipientPickerHandle,
} from "@/components/communications/RecipientPicker";
import type { AudiencePreview } from "@/lib/communications/audience";

type TabKey = "compose" | "audience" | "preview" | "history";

type Gender = "male" | "female";
type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";
type UploadMode = "inline" | "attachment";
type PendingSendAction = "test" | "broadcast";

type UploadUiRow = {
  upload_id: string; // message_uploads.id
  filename: string;
  content_type: string;
  bytes: number;
  mode: UploadMode;
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
  membership_stage: string | null; // keep loose; we filter visitor/member only
};

type HistoryRow = {
  id: string;
  created_at: string;
  subject: string;
  total_recipients: number;
  total_success: number;
  total_failure: number;
  total_skipped: number;
};

type HistoryDetailRecipient = {
  email: string;
  success: boolean;
  status: string;
  explanation: string | null;
};

type HistoryRecipientFilter = "all" | "sent" | "skipped" | "failed";

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

function isHistoryDetailPayload(v: unknown): v is HistoryDetailPayload {
  if (typeof v !== "object" || v === null) return false;

  const o = v as Record<string, unknown>;

  return (
    typeof o.subject === "string" &&
    typeof o.total_recipients === "number" &&
    typeof o.total_success === "number" &&
    typeof o.total_failure === "number" &&
    typeof o.total_skipped === "number" &&
    typeof o.total_unprocessed === "number" &&
    Array.isArray(o.recipients) &&
    o.recipients.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Record<string, unknown>).email === "string" &&
        typeof (r as Record<string, unknown>).success === "boolean" &&
        typeof (r as Record<string, unknown>).status === "string" &&
        (typeof (r as Record<string, unknown>).explanation === "string" ||
          (r as Record<string, unknown>).explanation === null),
    )
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePreviewHtml(html: string) {
  // Turn truly empty paragraphs OR <p><br></p> into <p>&nbsp;</p>
  // so they occupy vertical space in preview like the editor.
  return html
    .replace(/<p>\s*<\/p>/g, "<p>&nbsp;</p>")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/g, "<p>&nbsp;</p>");
}

function stripOuterHtmlDoc(html: string) {
  // TipTap returns fragments, but just in case:
  return html.replace(/<\/?(html|head|body)[^>]*>/gi, "");
}

type HistoryDetailPayload = {
  subject: string;
  total_recipients: number;
  total_success: number;
  total_failure: number;
  total_skipped: number;
  total_unprocessed: number;
  recipients: HistoryDetailRecipient[];
};

function historyRecipientFilter(recipient: HistoryDetailRecipient): Exclude<HistoryRecipientFilter, "all"> {
  if (recipient.status === "sent") return "sent";
  if (recipient.status.startsWith("skipped_") || recipient.status === "not_processed") {
    return "skipped";
  }
  return "failed";
}

function HistoryRecipientRow({
  recipient,
  selected,
  onToggle,
}: {
  recipient: HistoryDetailRecipient;
  selected: boolean;
  onToggle: () => void;
}) {
  const status = historyRecipientFilter(recipient);
  const canExpand = Boolean(recipient.explanation);

  return (
    <div className={selected ? "bg-slate-50" : ""}>
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? selected : undefined}
        onClick={onToggle}
        className={`grid w-full items-center px-4 py-3 text-left text-sm ${
          canExpand ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
        }`}
        style={{ gridTemplateColumns: "2fr 120px" }}
      >
        <div className="min-w-0 pr-3 text-slate-800">
          <div className="truncate">{recipient.email || "—"}</div>
          {canExpand ? (
            <div className="mt-0.5 text-xs text-slate-500">
              {selected ? "Hide details" : "View details"}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          {status === "sent" ? (
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              Success
            </span>
          ) : status === "skipped" ? (
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              Skipped
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
              Failed
            </span>
          )}
        </div>
      </button>
      {selected && recipient.explanation ? (
        <div
          className={`mx-4 mb-3 rounded-2xl border px-4 py-3 text-xs ${
            status === "failed"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <div className="font-semibold">
            {status === "failed" ? "Why delivery failed" : "Why this email was skipped"}
          </div>
          <div className="mt-1">{recipient.explanation}</div>
        </div>
      ) : null}
    </div>
  );
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

function displayedSkippedCount(row: Pick<HistoryRow, "total_recipients" | "total_success" | "total_failure" | "total_skipped">) {
  const notProcessed = Math.max(
    0,
    row.total_recipients - row.total_success - row.total_failure - (row.total_skipped ?? 0),
  );
  return (row.total_skipped ?? 0) + notProcessed;
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

  function toggle(k: string) {
    const has = selected.includes(k);
    onChange(has ? selected.filter((x) => x !== k) : [...selected, k]);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
        onClick={(e) => {
          e.stopPropagation();
          setOpenKey(open ? null : myKey);
        }}
      >
        {label}
        {selected.length ? (
          <span className="ml-2 text-xs text-slate-500">
            ({selected.length})
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute z-50 mt-2 w-56 rounded-2xl border bg-white shadow-lg overflow-hidden"
          onPointerDown={(e) => e.stopPropagation()}
        >
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

export default function CommunicationsPage() {
  const orgId = getActiveOrgId();

  const [tab, setTab] = useState<TabKey>("compose");
  const [orgName, setOrgName] = useState("Our Church");
  const [mailingAddressReady, setMailingAddressReady] = useState<boolean | null>(null);

  // Compose
  // const [subject, setSubject] = useState("Hello from {churchName}");
  const [subject, setSubject] = useState("Calvary Greetings!");

  // Uploads
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<UploadUiRow[]>([]);
  const [uploading, setUploading] = useState(false);

  // Audience
  const [memberQ, setMemberQ] = useState("");
  const [members] = useState<MemberRow[]>([]);
  const [membersLoading] = useState(false);

  const [genderFilter, setGenderFilter] = useState<string[]>([]); // ["male","female"]
  const [ageFilter, setAgeFilter] = useState<string[]>([]); // ["1-12",...]
  const [stageFilter, setStageFilter] = useState<string[]>([]); // ["visitor","member"]

  const [sendMap, setSendMap] = useState<Record<string, boolean>>({}); // memberId -> send?
  const [audiencePreview, setAudiencePreview] =
    useState<AudiencePreview | null>(null);
  const [hasAudienceSelections, setHasAudienceSelections] = useState(false);
  const [reviewAudienceOpen, setReviewAudienceOpen] = useState(false);
  const [reviewAfterAudienceOpen, setReviewAfterAudienceOpen] = useState(false);
  const recipientPickerRef = useRef<RecipientPickerHandle | null>(null);

  // Preview sending
  const [sending, setSending] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [sentOk, setSentOk] = useState(0);
  const [sentFail, setSentFail] = useState(0);
  const [sendErr, setSendErr] = useState("");

  // Test modal
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [filterOpenKey, setFilterOpenKey] = useState<string | null>(null);

  // History
  const [histQ, setHistQ] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState("");
  const [historyDetail, setHistoryDetail] =
    useState<HistoryDetailPayload | null>(null);
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false);
  const [historyRecipientStatus, setHistoryRecipientStatus] =
    useState<HistoryRecipientFilter>("all");
  const [selectedHistoryRecipient, setSelectedHistoryRecipient] =
    useState<string | null>(null);

  const editorRef = useRef<TipTapHandle | null>(null);

  const [replyToEmail, setReplyToEmail] = useState<string>(""); // single source of truth
  const [logoUrl, setLogoUrl] = useState<string | null>(null); // optional

  const [bodyHtml, setBodyHtml] = useState<string>("");

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

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  }

  // Preview (and also reuse for sending to avoid mismatch)
  const vars = useMemo(() => ({ churchName: orgName }), [orgName]);

  const [limitsOpen, setLimitsOpen] = useState(false);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsErr, setLimitsErr] = useState("");
  const [limits, setLimits] = useState<LimitsPayload | null>(null);

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

  useEffect(() => {
    function onDocPointerDown() {
      setFilterOpenKey(null);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, []);

  useEffect(() => {
    if (!orgName) return;

    setBodyHtml(`

    <span style="color:#1e40af; font-size:20px">
      <strong>Hello from ${escapeHtml(orgName)}</strong>
    </span>

    <p>
      We’re glad you’re here. Here are a few updates and ways to stay connected.
    </p>

    <ul>
      <li>Sunday Service - 10:00 AM</li>
      <li>Midweek Prayer - Wednesday, 7:00 PM</li>
      <li>Small Groups - Friday</li>
    </ul>

    <p>
      Yours in Christ,<br/>
      <strong>${escapeHtml(orgName)}</strong>
    </p>
  `);
  }, [orgName]);

  useEffect(() => {
    if (!orgId) return;

    (async () => {
      const [{ data: org }, { data: mailing }] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
        supabase
          .from("organization_settings")
          .select("mailing_address_line1,mailing_city,mailing_state,mailing_postal_code,mailing_country")
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);
      if (org?.name) setOrgName(org.name);
      setMailingAddressReady(Boolean(
        mailing?.mailing_address_line1 &&
        mailing?.mailing_city &&
        mailing?.mailing_state &&
        mailing?.mailing_postal_code &&
        mailing?.mailing_country
      ));
    })();
  }, [orgId]);

  const totalUploadBytes = useMemo(
    () => uploads.reduce((s, u) => s + (u.bytes || 0), 0),
    [uploads],
  );

  async function handleUploadFiles(files: FileList | null) {
    if (!orgId) return;
    if (!files || files.length === 0) return;

    // Guardrails
    const maxFiles = 10;
    const maxTotal = 20 * 1024 * 1024; // 20MB
    const selected = Array.from(files).slice(0, maxFiles);
    const selectedBytes = selected.reduce((s, f) => s + f.size, 0);

    if (selectedBytes + totalUploadBytes > maxTotal) {
      showToast("Too large (keep uploads under 20MB)");
      return;
    }

    setUploading(true);
    try {
      const token = await getAccessToken(); // string | null

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

        const inlineOk = isInlineableImage(upload.content_type);
        const mode: UploadMode = inlineOk ? "inline" : "attachment";
        const inline_cid = inlineOk ? makeCid() : undefined;

        setUploads((cur) => [
          ...cur,
          {
            upload_id: upload.id,
            bucket: upload.bucket,
            storage_path: upload.path,
            filename: upload.filename,
            content_type: upload.content_type,
            bytes: upload.bytes,
            mode,
            inline_cid,
            preview_url: signed_url,
          },
        ]);

        // Insert into TipTap at cursor
        if (inlineOk) {
          editorRef.current?.insertImage({
            src: signed_url,
            alt: upload.filename,
            uploadId: upload.id,
            align: "center",
          });
        }
      }

      showToast("Uploaded ✓");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

      const limits = await fetchMonthlyLimits(orgId, jwt);

      setConfirmAction(action);
      setConfirmCount(count);
      setConfirmPlan(limits.plan);
      setConfirmLeftBefore(limits.month_left);

      if (limits.month_left < count) {
        setInsufficient(true);
      }
    } catch (e) {
      setConfirmErr(e instanceof Error ? e.message : "Failed to check limits");
    } finally {
      setConfirmLoading(false);
    }
  }

  async function proceedSend() {
    if (insufficient) return; // no-op
    if (!confirmAction) return;

    setConfirmOpen(false);

    if (confirmAction === "test") {
      await sendTestInternal();
    } else {
      await sendBroadcastInternal();
    }
  }

  function openTestEmailModal() {
    setSendErr("");
    setTestOpen(true);
  }

  async function reviewTestSend() {
    const email = testEmail.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setSendErr("Provide a valid test email.");
      return;
    }
    setTestEmail(email);
    setSendErr("");
    setTestOpen(false);
    await requestSend("test", 1);
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

      const res = await fetch(
        `/api/communications/limits?organization_id=${encodeURIComponent(orgId)}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid response");
      }

      if (!res.ok) {
        const msg =
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed &&
          typeof (parsed as { error?: unknown }).error === "string"
            ? (parsed as { error: string }).error
            : "Failed to load limits";
        throw new Error(msg);
      }

      if (!isLimitsPayload(parsed)) throw new Error("Bad response");

      setLimits(parsed);
    } catch (e) {
      setLimitsErr(e instanceof Error ? e.message : "Failed to load limits");
    } finally {
      setLimitsLoading(false);
    }
  }

  function toggleUploadMode(upload_id: string) {
    setUploads((cur) =>
      cur.map((u) => {
        if (u.upload_id !== upload_id) return u;
        if (!isInlineableImage(u.content_type)) return u;

        // attachment -> inline
        if (u.mode === "attachment") {
          const cid = u.inline_cid ?? makeCid();

          if (u.preview_url) {
            editorRef.current?.insertImage({
              src: u.preview_url,
              alt: u.filename,
              uploadId: u.upload_id,
              align: "center",
            });
          }

          return { ...u, mode: "inline" as const, inline_cid: cid };
        }

        // inline -> attachment
        editorRef.current?.removeImagesByUploadId(upload_id);
        const { inline_cid: _drop, ...rest } = u;
        return { ...rest, mode: "attachment" as const };
      }),
    );
  }

  function removeUpload(upload_id: string) {
    setUploads((cur) => cur.filter((u) => u.upload_id !== upload_id));
    editorRef.current?.removeImagesByUploadId(upload_id);
  }

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
        // only apply visitor/member filters; anything else excluded
        const st = (m.membership_stage ?? "").toLowerCase();
        const ok =
          (stageFilter.includes("visitor") && st === "visitor") ||
          (stageFilter.includes("member") && st === "member");
        if (!ok) return false;
      }

      return true;
    });
  }, [members, memberQ, genderFilter, ageFilter, stageFilter]);

  const selectedMemberIds = useMemo(() => {
    return Object.keys(sendMap).filter((id) => sendMap[id] === true);
  }, [sendMap]);

  const selectedRecipientCount = audiencePreview?.total_recipients ?? 0;

  async function sendTestInternal() {
    setSendErr("");
    if (!orgId) return;

    const em = testEmail.trim().toLowerCase();
    if (!isValidEmail(em)) {
      setSendErr("Provide a valid test email.");
      return;
    }

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const createRes = await fetch("/api/communications/campaign/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          organization_id: orgId,
          subject: `[Test] ${previewSubject}`,
          body_html: previewHtml,
          total_recipients: 1,
        }),
      });

      const createJson = await createRes.json();
      if (!createRes.ok)
        throw new Error(createJson?.error ?? "Failed to create test campaign");

      const campaignId = String(createJson.campaign_id);

      const res = await fetch("/api/communications/send-one", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          organization_id: orgId,
          campaign_id: campaignId,
          to_email: em,
          reply_to: previewReplyTo,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to send test");

      showToast("Test sent ✓");
      setTestOpen(false);
      setTestEmail("");
      await loadHistory(); // optional
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Failed to send test");
      setTestOpen(true);
    }
  }

  async function sendBroadcastInternal() {
    setSendErr("");
    if (!orgId) return;

    if (selectedRecipientCount === 0) {
      setSendErr("Select at least one recipient in Audience.");
      return;
    }

    // reset progress
    setSending(true);
    setProgressPct(0);
    setSentOk(0);
    setSentFail(0);

    try {
      const subj = previewSubject;
      const bod = previewHtml.trim();

      if (!subj) throw new Error("Subject required");
      if (!bod) throw new Error("Body required");

      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      // Create a campaign (for History)
      const createRes = await fetch("/api/communications/campaign/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          organization_id: orgId,
          subject: previewSubject,
          body_html: previewHtml,
          uploads: uploads.map((u) => ({
            upload_id: u.upload_id,
            upload_mode: u.mode,
            inline_cid: u.mode === "inline" ? u.inline_cid : undefined,
          })),
          audience_snapshot_id: audiencePreview?.snapshot_id,
        }),
      });

      const createJson = await createRes.json().catch(() => null);
      if (!createRes.ok)
        throw new Error(
          String(createJson?.error ?? "Failed to start campaign"),
        );
      const campaignId = String(createJson.campaign_id);
      const recipientIds = Array.isArray(createJson?.recipient_ids)
        ? createJson.recipient_ids.map(String)
        : [];
      if (recipientIds.length !== audiencePreview?.total_recipients) {
        throw new Error("The recipient preview changed. Review the audience again.");
      }

      // Loop send one-by-one so we can show progress
      let ok = 0;
      let fail = 0;
      let skipped = 0;

      for (let i = 0; i < recipientIds.length; i++) {
        const recipientId = recipientIds[i];

        const res = await fetch("/api/communications/send-one", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            organization_id: orgId,
            mode: "broadcast",
            campaign_id: campaignId,
            audience_snapshot_id: audiencePreview?.snapshot_id,
            audience_recipient_id: recipientId,
          }),
        });

        const json = await res.json().catch(() => null);
        if (res.ok && json?.ok && json?.skipped) skipped++;
        else if (res.ok && json?.ok) ok++;
        else fail++;

        setSentOk(ok);
        setSentFail(fail);
        setProgressPct(Math.round(((i + 1) / recipientIds.length) * 100));
      }

      showToast(`Broadcast done ✓ (${ok} sent, ${skipped} skipped, ${fail} failed)`);
      // refresh history
      await loadHistory();
      setTab("history");
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setSending(false);
    }
  }

  async function loadHistory() {
    if (!orgId) return;
    setHistoryErr("");
    setHistoryLoading(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const jwt = sessionRes.session?.access_token;
      if (!jwt) throw new Error("Unauthorized");

      const res = await fetch(
        `/api/communications/history/list?organization_id=${encodeURIComponent(orgId)}`,
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

  const filteredHistoryRecipients = useMemo(() => {
    const recipients = historyDetail?.recipients ?? [];
    if (historyRecipientStatus === "all") return recipients;
    return recipients.filter(
      (recipient) => historyRecipientFilter(recipient) === historyRecipientStatus,
    );
  }, [historyDetail, historyRecipientStatus]);

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
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed &&
          typeof (parsed as { error?: unknown }).error === "string"
        ) {
          throw new Error((parsed as { error: string }).error);
        }
        throw new Error("Failed to load detail");
      }

      if (!isHistoryDetailPayload(parsed)) {
        throw new Error("Bad response");
      }

      setHistoryDetail(parsed);
      setHistoryRecipientStatus("all");
      setSelectedHistoryRecipient(null);
      setHistoryDetailOpen(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load detail");
    }
  }

  function navigateToTab(nextTab: TabKey) {
    if (nextTab === "preview" && !audiencePreview) {
      if (hasAudienceSelections) {
        setReviewAudienceOpen(true);
      } else {
        showToast("Choose and review an audience before opening the preview.");
        setTab("audience");
      }
      return;
    }
    setTab(nextTab);
  }

  useEffect(() => {
    if (tab !== "audience" || !reviewAfterAudienceOpen) return;
    setReviewAfterAudienceOpen(false);
    void recipientPickerRef.current?.reviewAudience();
  }, [reviewAfterAudienceOpen, tab]);

  return (
    <>
      {/* Header + tab stubs */}
      <div className="border-b">
        <div className="px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xl font-semibold">Email</div>
              <div className="text-sm text-slate-600">
                Email broadcasts with images + attachments.
              </div>
            </div>
            <Link href="/app/communications" className="self-start rounded-2xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              Back to Communications
            </Link>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex self-start rounded-2xl border bg-slate-50 p-1">
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
                  onClick={() => navigateToTab(k)}
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
            {tab === "audience" ? (
              <button
                type="button"
                disabled={!hasAudienceSelections}
                onClick={() => {
                  if (audiencePreview) navigateToTab("preview");
                  else void recipientPickerRef.current?.reviewAudience();
                }}
                className="self-start rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
              >
                {audiencePreview ? "Next" : "Review audience"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        {mailingAddressReady === false ? (
          <div className="mb-5 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold">Organization mailing address not set up</div>
                <p className="mt-1 text-sm text-amber-900">
                  A valid mailing address is shown in broadcast footers and is required before Church Admin can send a broadcast.
                </p>
                <a
                  href="https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-sm font-semibold underline underline-offset-2"
                >
                  Why is this needed?
                </a>
              </div>
              <Link
                href="/app/settings/org#email-mailing-address"
                className="shrink-0 self-start rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/85 sm:self-auto"
              >
                Set up mailing address
              </Link>
            </div>
          </div>
        ) : null}

        {/* COMPOSE */}
        {tab === "compose" ? (
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-6 py-4">
              <div className="text-lg font-semibold">Compose Email</div>
            </div>

            <div className="px-6 py-6 space-y-5">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Subject *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Body *
                </div>

                <TipTap
                  ref={editorRef}
                  valueHtml={bodyHtml}
                  onChangeHtml={setBodyHtml}
                  // minHeight={200}
                  // maxHeight={500}
                />
              </div>

              {/* Uploads */}
              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Images & files</div>
                    <div className="text-xs text-slate-600 mt-1">
                      Inline or attachment images supported · Place cursor to
                      insert inline image · Max ≤ 20 MB
                    </div>
                  </div>

                  <div className="shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
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
                    {uploads.map((u) => {
                      const img = isInlineableImage(u.content_type);
                      return (
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
                              {u.mode === "inline" && u.inline_cid
                                ? ` • cid:${u.inline_cid}`
                                : ""}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {img ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-600">
                                  {u.mode === "inline"
                                    ? "Inline Image"
                                    : "Attachment"}
                                </span>

                                <button
                                  className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                  onClick={() => toggleUploadMode(u.upload_id)}
                                >
                                  {u.mode === "inline"
                                    ? "Switch to Attachment"
                                    : "Switch to Inline"}
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">
                                Attachment
                              </span>
                            )}

                            <button
                              className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                              onClick={() => removeUpload(u.upload_id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    <div className="text-xs text-slate-600 mt-2">
                      Total uploads:{" "}
                      <span className="font-semibold">
                        {formatBytes(totalUploadBytes)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-slate-600">
                    No uploads yet.
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
        {orgId ? (
          <div className={tab === "audience" ? "" : "hidden"} aria-hidden={tab !== "audience"}>
            <RecipientPicker
              ref={recipientPickerRef}
              orgId={orgId}
              value={audiencePreview}
              onApply={setAudiencePreview}
              onContinue={() => navigateToTab("preview")}
              onSelectionStateChange={setHasAudienceSelections}
            />
          </div>
        ) : null}

        {/* Legacy audience retained temporarily for reference while the new picker settles. */}
        {false && tab === "audience" ? (
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
                        setStageFilter([]);
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
                    const send = sendMap[m.id] === true; // default false

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
                            <span>{send ? "True" : "False"}</span>
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
                Test send or broadcast to selected audience.
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

              {/* Progress bar */}
              {sending ? (
                <div className="rounded-2xl border p-4">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Sending…</span>
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
                    Failed: <span className="font-semibold">{sentFail}</span>
                  </div>
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
                          {selectedRecipientCount}
                        </span>
                      </div>

                      <div className="text-slate-700">
                        Uploads:{" "}
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
                </div>

                <div className="px-6 py-6">
                  {/* optional logo area */}
                  {logoUrl ? (
                    <div className="mb-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logoUrl} alt="logo" className="h-10 w-auto" />
                    </div>
                  ) : null}
                  <style jsx global>{`
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
                    className="rounded-2xl border px-5 py-2 text-sm hover:bg-slate-50"
                    onClick={openTestEmailModal}
                  >
                    Send test
                  </button>

                  {mailingAddressReady === false ? (
                    <Link
                      href="/app/settings/org#email-mailing-address"
                      className="rounded-2xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/85"
                    >
                      Set up mailing address
                    </Link>
                  ) : mailingAddressReady === true ? (
                    <button
                      className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${
                        sending
                          ? "bg-slate-300"
                          : "bg-primary hover:bg-primary/85"
                      }`}
                      disabled={sending}
                      onClick={() =>
                        requestSend("broadcast", selectedRecipientCount)
                      }
                    >
                      Send broadcast
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="rounded-2xl bg-slate-300 px-5 py-2 text-sm font-semibold text-white"
                    >
                      Checking mailing address…
                    </button>
                  )}
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
                Broadcast runs and results.
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

            <div className="overflow-x-auto border-t">
              <div
                className="grid min-w-[900px] bg-slate-50 px-6 py-3 text-xs font-semibold text-slate-600"
                style={{ gridTemplateColumns: "140px minmax(260px,1fr) 140px 280px" }}
              >
                <div>Date</div>
                <div>Subject</div>
                <div className="text-right">Total recipients</div>
                <div className="text-right">Results</div>
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
                      className="grid min-w-[900px] w-full items-center px-6 py-4 text-left text-sm hover:bg-slate-50"
                      style={{ gridTemplateColumns: "140px minmax(260px,1fr) 140px 280px" }}
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
                        <div className="font-semibold text-slate-900">{h.total_success} successful</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {displayedSkippedCount(h)} skipped · {h.total_failure ?? 0} failed
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {reviewAudienceOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setReviewAudienceOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-lg font-semibold">Review selected audience?</div>
              <div className="mt-1 text-sm text-slate-600">
                You have selected recipients, but the audience has not been reviewed yet. Review it before opening the email preview.
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4">
              <button
                type="button"
                className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                onClick={() => setReviewAudienceOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
                onClick={() => {
                  setReviewAudienceOpen(false);
                  setReviewAfterAudienceOpen(true);
                  setTab("audience");
                }}
              >
                Review audience
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Test modal */}
      {testOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setTestOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">Send test email</div>
              <div className="text-xs text-slate-600">
                Test sends appear in History. A successful test uses one email from this month&apos;s allowance.
              </div>
            </div>

            <div className="px-6 py-6 space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Email *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              {sendErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {sendErr}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setTestOpen(false)}
              >
                Cancel
              </button>

              <button
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => void reviewTestSend()}
              >
                Send test
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
                      Sorry, you don&apos;t have enough emails left to send this{" "}
                      {confirmAction === "broadcast" ? "broadcast" : "test"}.
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
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
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

            <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-6">
              <div className="grid gap-3 sm:grid-cols-4">
                <button
                  type="button"
                  aria-pressed={historyRecipientStatus === "all"}
                  onClick={() => {
                    setHistoryRecipientStatus("all");
                    setSelectedHistoryRecipient(null);
                  }}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    historyRecipientStatus === "all"
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "bg-slate-50 hover:border-primary/50 hover:bg-white"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-600">
                    Total recipients
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {historyDetail?.total_recipients ?? 0}
                  </div>
                </button>

                <button
                  type="button"
                  aria-pressed={historyRecipientStatus === "skipped"}
                  onClick={() => {
                    setHistoryRecipientStatus("skipped");
                    setSelectedHistoryRecipient(null);
                  }}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    historyRecipientStatus === "skipped"
                      ? "border-amber-400 bg-amber-50 ring-1 ring-amber-400"
                      : "bg-slate-50 hover:border-amber-300 hover:bg-amber-50/50"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-600">Skipped</div>
                  <div className="mt-1 text-lg font-semibold">
                    {(historyDetail?.total_skipped ?? 0) + (historyDetail?.total_unprocessed ?? 0)}
                  </div>
                </button>

                <button
                  type="button"
                  aria-pressed={historyRecipientStatus === "sent"}
                  onClick={() => {
                    setHistoryRecipientStatus("sent");
                    setSelectedHistoryRecipient(null);
                  }}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    historyRecipientStatus === "sent"
                      ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-400"
                      : "bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-600">
                    Success
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {historyDetail?.total_success ?? 0}
                  </div>
                </button>

                <button
                  type="button"
                  aria-pressed={historyRecipientStatus === "failed"}
                  onClick={() => {
                    setHistoryRecipientStatus("failed");
                    setSelectedHistoryRecipient(null);
                  }}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    historyRecipientStatus === "failed"
                      ? "border-red-400 bg-red-50 ring-1 ring-red-400"
                      : "bg-slate-50 hover:border-red-300 hover:bg-red-50/50"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-600">
                    Failed
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {historyDetail?.total_failure ?? 0}
                  </div>
                </button>

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
                  {filteredHistoryRecipients.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-slate-600">
                      No {historyRecipientStatus === "all" ? "recipient" : historyRecipientStatus} rows found.
                    </div>
                  ) : (
                    filteredHistoryRecipients.map((recipient, idx) => {
                      const recipientKey = `${recipient.email}-${recipient.status}-${idx}`;
                      return (
                        <HistoryRecipientRow
                          key={recipientKey}
                          recipient={recipient}
                          selected={selectedHistoryRecipient === recipientKey}
                          onToggle={() =>
                            recipient.explanation &&
                            setSelectedHistoryRecipient((current) =>
                              current === recipientKey ? null : recipientKey,
                            )
                          }
                        />
                      );
                    })
                  )}
                </div>
              </div>

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
