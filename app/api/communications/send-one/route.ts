import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendManagedEmail } from "@/lib/server/email";
import { requireUser, requireOrgFinanceOrAbove } from "@/lib/serverAuthz";
import {
  assertBurstLimit,
  consumeBurst,
  assertMonthlyQuota,
  consumeMonthlyQuota,
} from "@/lib/server/communicationsLimits";

export const runtime = "nodejs";

type ErrorJson = { error: string };
type OkJson = { ok: true; skipped?: boolean; skip_reason?: string };

type Body = {
  organization_id?: string;
  campaign_id?: string;
  to_email?: string;
  mode?: "test" | "broadcast";
  audience_snapshot_id?: string;
  audience_recipient_id?: string;
  // optional overrides for test mode:
  subject?: string;
  body_html?: string;
  reply_to?: string | null;
};

function isValidEmail(v: string) {
  const s = v.trim();
  return s.includes("@") && s.length <= 254;
}

function formatFrom(displayName: string, fromEmail: string) {
  const cleanName = displayName.replace(/[\r\n"]/g, " ").trim();
  return `${cleanName} <${fromEmail}>`;
}

/** ---- Upload types (adapt fields to your actual table) ---- */
type UploadRow = {
  id: string;
  bucket: string;
  path: string;
  filename: string;
  content_type: string | null;
  upload_mode: "inline" | "attachment" | string | null;
  inline_cid: string | null;

  preview_url: string | null;
};

async function downloadFileBase64(bucket: string, path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(path);
  if (error) throw new Error(error.message);

  const buf = Buffer.from(await data.arrayBuffer());
  return buf.toString("base64");
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteInlineImages(html: string, uploads: UploadRow[]) {
  let out = html;

  for (const u of uploads) {
    if (u.upload_mode !== "inline" || !u.inline_cid) continue;

    // A) by data-upload-id
    const reById = new RegExp(
      `(<img\\b[^>]*\\bdata-upload-id=["']${escapeRegExp(u.id)}["'][^>]*\\bsrc=["'])([^"']*)(["'])`,
      "gi",
    );
    out = out.replace(reById, `$1cid:${u.inline_cid}$3`);

    // B) by preview_url exact match
    if (u.preview_url) {
      const reByUrl = new RegExp(
        `(<img\\b[^>]*\\bsrc=["'])${escapeRegExp(u.preview_url)}(["'])`,
        "gi",
      );
      out = out.replace(reByUrl, `$1cid:${u.inline_cid}$2`);
    }

    // ✅ C) by storage path appearing inside the src (covers signed/public URLs)
    if (u.path) {
      const reByPathInSrc = new RegExp(
        `(<img\\b[^>]*\\bsrc=["'])([^"']*${escapeRegExp(u.path)}[^"']*)(["'])`,
        "gi",
      );
      out = out.replace(reByPathInSrc, `$1cid:${u.inline_cid}$3`);
    }
  }

  return out;
}

export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok)
      return NextResponse.json<ErrorJson>(
        { error: u.error },
        { status: u.status },
      );

    const body = (await req.json().catch(() => null)) as Body | null;
    const organization_id = String(body?.organization_id ?? "").trim();
    const campaign_id = String(body?.campaign_id ?? "").trim();
    const mode = body?.mode === "broadcast" ? "broadcast" : "test";
    const audienceSnapshotId = String(body?.audience_snapshot_id ?? "").trim();
    const audienceRecipientId = String(body?.audience_recipient_id ?? "").trim();
    let to_email = String(body?.to_email ?? "")
      .trim()
      .toLowerCase();
    let recipientMemberId: string | null = null;

    if (!organization_id)
      return NextResponse.json<ErrorJson>(
        { error: "organization_id required" },
        { status: 400 },
      );
    if (!campaign_id)
      return NextResponse.json<ErrorJson>(
        { error: "campaign_id required" },
        { status: 400 },
      );
    const authz = await requireOrgFinanceOrAbove(organization_id, u.userId);
    if (!authz.ok)
      return NextResponse.json<ErrorJson>(
        { error: authz.error },
        { status: authz.status },
      );

    if (mode === "broadcast") {
      if (!audienceSnapshotId || !audienceRecipientId) {
        return NextResponse.json<ErrorJson>({ error: "Recipient snapshot required" }, { status: 400 });
      }
      const { data: snapshot, error: snapshotError } = await supabaseAdmin
        .from("communication_audience_snapshots")
        .select("id,campaign_id")
        .eq("id", audienceSnapshotId)
        .eq("org_id", organization_id)
        .eq("created_by", u.userId)
        .eq("campaign_id", campaign_id)
        .maybeSingle<{ id: string; campaign_id: string }>();
      if (snapshotError) throw new Error(snapshotError.message);
      if (!snapshot) return NextResponse.json<ErrorJson>({ error: "Recipient snapshot not found" }, { status: 404 });

      const { data: recipient, error: recipientError } = await supabaseAdmin
        .from("communication_audience_snapshot_recipients")
        .select("id,email,member_id,processed_at")
        .eq("id", audienceRecipientId)
        .eq("snapshot_id", audienceSnapshotId)
        .eq("org_id", organization_id)
        .maybeSingle<{ id: string; email: string; member_id: string | null; processed_at: string | null }>();
      if (recipientError) throw new Error(recipientError.message);
      if (!recipient) return NextResponse.json<ErrorJson>({ error: "Recipient not found" }, { status: 404 });
      if (recipient.processed_at) return NextResponse.json<OkJson>({ ok: true });
      to_email = recipient.email.trim().toLowerCase();
      recipientMemberId = recipient.member_id;
    }

    if (!to_email || !isValidEmail(to_email))
      return NextResponse.json<ErrorJson>(
        { error: "Valid recipient email required" },
        { status: 400 },
      );

    // Rate limit (burst)
    const burst = await assertBurstLimit(organization_id, 1);
    if (!burst.ok)
      return NextResponse.json<ErrorJson>(
        { error: burst.error },
        { status: 429 },
      );

    // Monthly limit
    const quota = await assertMonthlyQuota(organization_id, 1);
    if (!quota.ok)
      return NextResponse.json<ErrorJson>(
        { error: quota.error },
        { status: 402 },
      );

    // Fetch campaign (subject/body)
    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("communication_campaigns")
      .select("id, subject, body_html")
      .eq("id", campaign_id)
      .eq("organization_id", organization_id)
      .maybeSingle<{ id: string; subject: string; body_html: string }>();

    if (campErr) throw new Error(campErr.message);
    if (!campaign)
      return NextResponse.json<ErrorJson>(
        { error: "Campaign not found" },
        { status: 404 },
      );

    // Org name for From
    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .maybeSingle<{ name: string | null }>();

    if (orgErr) throw new Error(orgErr.message);
    const orgName = String(org?.name ?? "Our Church").trim() || "Our Church";
    const from = formatFrom(orgName, process.env.RESEND_FROM!);

    const replyToRaw =
      body?.reply_to === null ? "" : String(body?.reply_to ?? "").trim();
    const replyTo = replyToRaw ? replyToRaw.toLowerCase() : "";
    if (replyTo && !isValidEmail(replyTo))
      return NextResponse.json<ErrorJson>(
        { error: "reply_to invalid" },
        { status: 400 },
      );

    // --------- NEW: Fetch uploads + build attachments ----------
    const { data: uploads, error: upErr } = await supabaseAdmin
      .from("message_uploads")
      .select(
        "id, bucket, path, filename, content_type, upload_mode, inline_cid, preview_url",
      )
      .eq("campaign_id", campaign_id);

    if (upErr) throw new Error(upErr.message);

    const uploadRows = (uploads ?? []) as UploadRow[];

    const attachmentsRaw = await Promise.all(
      uploadRows.map(async (file) => {
        if (!file.bucket || !file.path || !file.filename) return null;

        const base64 = await downloadFileBase64(file.bucket, file.path);

        const common = {
          filename: file.filename,
          content: base64,
          ...(file.content_type ? { contentType: file.content_type } : {}),
        };

        if (file.upload_mode === "inline" && file.inline_cid) {
          return { ...common, contentId: file.inline_cid };
        }

        return common;
      }),
    );

    const attachments = attachmentsRaw.filter(Boolean) as Array<{
      filename: string;
      content: string;
      contentType?: string;
      contentId?: string;
    }>;

    // --------- NEW: Rewrite HTML to cid:... for inline images ----------
    const htmlFromBody = String(body?.body_html ?? "") || campaign.body_html;
    const subjectFromBody = String(body?.subject ?? "") || campaign.subject;

    const firstImg = htmlFromBody.match(/<img\b[^>]*>/i)?.[0] ?? null;
    console.log("first img tag:", firstImg);

    const htmlWithCid = rewriteInlineImages(htmlFromBody, uploadRows);
    console.log("has cid:", htmlWithCid.includes("cid:"));

    // Send
    const sendRes = await sendManagedEmail({
      kind: mode === "broadcast" ? "optional" : "internal",
      ...(mode === "broadcast" ? { topic: "broadcast" as const, organizationId: organization_id, memberId: recipientMemberId, requireMailingAddress: true } : {}),
      from,
      to: to_email,
      subject: subjectFromBody,
      html: htmlWithCid,
      ...(replyTo ? { replyTo } : {}),
      ...(attachments.length ? { attachments } : {}),
      tags: [{ name: "message_type", value: mode === "broadcast" ? "broadcast" : "test" }],
    });

    const providerId = sendRes.sent ? sendRes.providerId : null;
    const success = sendRes.sent;

    if (!sendRes.sent && sendRes.skipped && sendRes.reason === "missing_mailing_address") {
      return NextResponse.json<ErrorJson>(
        { error: "Add a complete mailing address in Organization Settings before sending broadcasts." },
        { status: 409 },
      );
    }

    if (!sendRes.sent && sendRes.skipped) {
      if (mode === "broadcast") {
        const outcome = sendRes.reason === "suppressed" ? "skipped_suppressed" : "skipped_unsubscribed";
        await supabaseAdmin.from("communication_audience_snapshot_recipients").update({
          processed_at: new Date().toISOString(),
          success: false,
          outcome,
          skipped_reason: sendRes.reason,
          error: null,
        }).eq("id", audienceRecipientId).eq("snapshot_id", audienceSnapshotId).eq("org_id", organization_id).is("processed_at", null);
        await supabaseAdmin.rpc("increment_campaign_skipped", { p_campaign_id: campaign_id });
      }
      return NextResponse.json<OkJson>({ ok: true, skipped: true, skip_reason: sendRes.reason });
    }

    if (mode === "broadcast") {
      await supabaseAdmin
        .from("communication_audience_snapshot_recipients")
        .update({
          processed_at: new Date().toISOString(),
          success,
          provider_id: providerId,
          outcome: success ? "sent" : "failed",
          skipped_reason: null,
          error: !sendRes.sent && !sendRes.skipped ? sendRes.error : null,
        })
        .eq("id", audienceRecipientId)
        .eq("snapshot_id", audienceSnapshotId)
        .eq("org_id", organization_id)
        .is("processed_at", null);
    }

    // Log recipient
    await supabaseAdmin.from("communication_campaign_recipients").insert({
      campaign_id,
      to_email,
      success,
      error: !sendRes.sent && !sendRes.skipped ? sendRes.error : null,
      provider: "resend",
      provider_id: providerId,
    });

    // Campaign totals (you already have this right)
    if (success) {
      await supabaseAdmin.rpc("increment_campaign_success", {
        p_campaign_id: campaign_id,
      });
    } else {
      await supabaseAdmin.rpc("increment_campaign_failure", {
        p_campaign_id: campaign_id,
      });
    }

    if (!sendRes.sent && !sendRes.skipped) {
      return NextResponse.json(
        { error: sendRes.error },
        { status: 400 },
      );
    }

    // Consume AFTER success (don’t charge for failed provider sends)
    await consumeBurst(organization_id, 1);
    await consumeMonthlyQuota(organization_id, 1);

    return NextResponse.json<OkJson>({ ok: true });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
