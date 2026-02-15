export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, requireOrgOwnerOrAdmin } from "@/lib/serverAuthz";
import {
  assertBurstLimit,
  consumeBurst,
  assertMonthlyQuota,
  consumeMonthlyQuota,
} from "@/lib/server/communicationsLimits";

import type { Browser, Page } from "puppeteer-core";

import type {
  RunMemberGivingBody,
  PaymentMethod,
} from "@/lib/reports/members/types";
import { renderMemberGivingHtml } from "@/lib/server/reports/memberGivingHtml";
import { runMemberGivingReportAsAdmin } from "@/lib/server/reports/memberGivingAdmin";
import { launchBrowser } from "@/lib/server/pdf/launchBrowser";

const resend = new Resend(process.env.RESEND_API_KEY!);

type ErrorJson = { error: string };
type OkJson = {
  ok: true;
  status: "running" | "paused" | "done" | "error";
  paused_reason?: "burst_limit" | "monthly_quota" | "unknown" | null;
  total: number;
  sent_success: number;
  sent_failure: number;
  processed_now: number;
  done: boolean;
};

type Body = {
  organization_id?: string;
  job_id?: string;
  batch_size?: number; // default 3
};

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

function isValidEmail(v: string) {
  const s = v.trim();
  return s.includes("@") && s.length <= 254;
}

function formatFrom(displayName: string, fromEmail: string) {
  const cleanName = displayName.replace(/[\r\n"]/g, " ").trim();
  return `${cleanName} <${fromEmail}>`;
}

async function downloadFileBase64(bucket: string, path: string) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
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

    const reById = new RegExp(
      `(<img\\b[^>]*\\bdata-upload-id=["']${escapeRegExp(
        u.id,
      )}["'][^>]*\\bsrc=["'])([^"']*)(["'])`,
      "gi",
    );
    out = out.replace(reById, `$1cid:${u.inline_cid}$3`);

    if (u.preview_url) {
      const reByUrl = new RegExp(
        `(<img\\b[^>]*\\bsrc=["'])${escapeRegExp(u.preview_url)}(["'])`,
        "gi",
      );
      out = out.replace(reByUrl, `$1cid:${u.inline_cid}$2`);
    }

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

function safeFilePart(s: string) {
  return s.replace(/[^\w\-]+/g, "_").slice(0, 80);
}

async function withRetry<T>(fn: () => Promise<T>, tries = 2) {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

async function pdfBase64UsingPage(page: Page, html: string): Promise<string> {
  await withRetry(async () => {
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.emulateMediaType("screen");
    await new Promise((r) => setTimeout(r, 150)); // settle layout/fonts
  }, 2);

  const pdf = await withRetry(
    () =>
      page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" },
      }),
    2,
  );

  return Buffer.from(pdf).toString("base64");
}

function buildFiltersLine(body: Omit<RunMemberGivingBody, "mode">): string {
  const parts: string[] = [];
  if (body.service_ids?.length) parts.push(`Services: ${body.service_ids.length}`);
  if (body.category_ids?.length) parts.push(`Categories: ${body.category_ids.length}`);
  if (body.payment_methods?.length) parts.push(`Methods: ${body.payment_methods.join(", ")}`);
  return parts.join(" • ");
}

async function computeJobCounts(job_id: string) {
  const { data, error } = await supabaseAdmin
    .from("report_email_job_recipients")
    .select("status")
    .eq("job_id", job_id);

  if (error) throw new Error(error.message);

  let ok = 0;
  let fail = 0;
  let pending = 0;
  let processing = 0;
  let skipped = 0;

  for (const r of data ?? []) {
    if (r.status === "success") ok++;
    else if (r.status === "failure") fail++;
    else if (r.status === "pending") pending++;
    else if (r.status === "processing") processing++;
    else if (r.status === "skipped") skipped++;
  }

  const doneNow = pending === 0 && processing === 0;
  return { ok, fail, skipped, pending, processing, doneNow };
}

export async function POST(req: Request) {
  // For releasing lock in finally
  let lockOwner: string | null = null;
  let organization_id = "";
  let job_id = "";

  try {
    const u = await requireUser(req);
    if (!u.ok) {
      return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    organization_id = String(body?.organization_id ?? "").trim();
    job_id = String(body?.job_id ?? "").trim();

    const batch_size_raw = Number(body?.batch_size ?? 3);
    const batch_size = Number.isFinite(batch_size_raw)
      ? Math.min(10, Math.max(1, Math.floor(batch_size_raw)))
      : 3;

    if (!organization_id) {
      return NextResponse.json<ErrorJson>({ error: "organization_id required" }, { status: 400 });
    }
    if (!job_id) {
      return NextResponse.json<ErrorJson>({ error: "job_id required" }, { status: 400 });
    }

    const authz = await requireOrgOwnerOrAdmin(organization_id, u.userId);
    if (!authz.ok) {
      return NextResponse.json<ErrorJson>({ error: authz.error }, { status: authz.status });
    }

    // Load job (includes lock columns)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("report_email_jobs")
      .select(
        "id, org_id, campaign_id, status, paused_reason, total, sent_success, sent_failure, start_date, end_date, service_ids, category_ids, payment_methods, attach_summary, attach_detailed, reply_to, pump_locked_at, pump_locked_by",
      )
      .eq("id", job_id)
      .eq("org_id", organization_id)
      .maybeSingle<{
        id: string;
        org_id: string;
        campaign_id: string;
        status: "running" | "paused" | "done" | "error";
        paused_reason: string | null;
        total: number;
        sent_success: number;
        sent_failure: number;
        start_date: string;
        end_date: string;
        service_ids: string[] | null;
        category_ids: string[] | null;
        payment_methods: string[] | null;
        attach_summary: boolean;
        attach_detailed: boolean;
        reply_to: string | null;
        pump_locked_at: string | null;
        pump_locked_by: string | null;
      }>();

    if (jobErr) throw new Error(jobErr.message);
    if (!job) {
      return NextResponse.json<ErrorJson>({ error: "Job not found" }, { status: 404 });
    }

    // If already done, return computed truth (so UI never lies)
    if (job.status === "done") {
      const counts = await computeJobCounts(job_id);
      return NextResponse.json<OkJson>({
        ok: true,
        status: "done",
        paused_reason: null,
        total: Number(job.total ?? 0),
        sent_success: counts.ok,
        sent_failure: counts.fail + counts.skipped,
        processed_now: 0,
        done: true,
      });
    }

    // -----------------------------
    // DB LOCK (prevents concurrent pumps on Vercel → stops ETXTBSY)
    // -----------------------------
    lockOwner = `${process.env.VERCEL_REGION ?? "local"}:${process.pid}:${Date.now()}`;
    const staleIso = new Date(Date.now() - 2 * 60_000).toISOString(); // 2 min stale

    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("report_email_jobs")
      .update({ pump_locked_at: new Date().toISOString(), pump_locked_by: lockOwner })
      .eq("id", job_id)
      .eq("org_id", organization_id)
      // acquire if unlocked OR stale
      .or(`pump_locked_at.is.null,pump_locked_at.lt.${staleIso}`)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (lockErr) throw new Error(lockErr.message);

    // Someone else is pumping right now — return current truth without doing work
    if (!locked) {
      const counts = await computeJobCounts(job_id);
      return NextResponse.json<OkJson>({
        ok: true,
        status: counts.doneNow ? "done" : "running",
        paused_reason: null,
        total: Number(job.total ?? 0),
        sent_success: counts.ok,
        sent_failure: counts.fail + counts.skipped,
        processed_now: 0,
        done: counts.doneNow,
      });
    }

    // Fetch campaign (subject/body)
    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("communication_campaigns")
      .select("id, subject, body_html")
      .eq("id", job.campaign_id)
      .eq("organization_id", organization_id)
      .maybeSingle<{ id: string; subject: string; body_html: string }>();

    if (campErr) throw new Error(campErr.message);
    if (!campaign) {
      return NextResponse.json<ErrorJson>({ error: "Campaign not found" }, { status: 404 });
    }

    // Org name (From:)
    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .maybeSingle<{ name: string | null }>();

    if (orgErr) throw new Error(orgErr.message);

    const orgName = String(org?.name ?? "Our Church").trim() || "Our Church";
    const from = formatFrom(orgName, process.env.RESEND_FROM!);

    // Uploads (inline images + attachments)
    const { data: uploads, error: upErr } = await supabaseAdmin
      .from("message_uploads")
      .select("id, bucket, path, filename, content_type, upload_mode, inline_cid, preview_url")
      .eq("campaign_id", job.campaign_id);

    if (upErr) throw new Error(upErr.message);
    const uploadRows = (uploads ?? []) as UploadRow[];

    const uploadAttachmentsRaw = await Promise.all(
      uploadRows.map(async (file) => {
        if (!file.bucket || !file.path || !file.filename) return null;

        const base64 = await downloadFileBase64(file.bucket, file.path);

        const common = {
          filename: file.filename,
          content: base64,
          ...(file.content_type ? { contentType: file.content_type } : {}),
        };

        // inline images need contentId for cid:
        if (file.upload_mode === "inline" && file.inline_cid) {
          return { ...common, contentId: file.inline_cid };
        }

        return common;
      }),
    );

    const uploadAttachments = uploadAttachmentsRaw.filter(Boolean) as Array<{
      filename: string;
      content: string;
      contentType?: string;
      contentId?: string;
    }>;

    // Rewrite inline images once per pump
    const htmlWithCid = rewriteInlineImages(campaign.body_html, uploadRows);

    // Find next pending recipients
    const { data: pending, error: pErr } = await supabaseAdmin
      .from("report_email_job_recipients")
      .select("idx, member_id, to_email, display_name, status")
      .eq("job_id", job_id)
      .eq("status", "pending")
      .order("idx", { ascending: true })
      .limit(batch_size);

    if (pErr) throw new Error(pErr.message);

    const targets = (pending ?? []) as Array<{
      idx: number;
      member_id: string | null;
      to_email: string;
      display_name: string | null;
      status: string;
    }>;

    // No targets → finalize using computed truth
    if (!targets.length) {
      const counts = await computeJobCounts(job_id);

      await supabaseAdmin
        .from("report_email_jobs")
        .update({
          status: counts.doneNow ? "done" : "running",
          paused_reason: null,
          sent_success: counts.ok,
          sent_failure: counts.fail + counts.skipped,
        })
        .eq("id", job_id)
        .eq("org_id", organization_id);

      return NextResponse.json<OkJson>({
        ok: true,
        status: counts.doneNow ? "done" : "running",
        paused_reason: null,
        total: Number(job.total ?? 0),
        sent_success: counts.ok,
        sent_failure: counts.fail + counts.skipped,
        processed_now: 0,
        done: counts.doneNow,
      });
    }

    // If paused, attempt resume automatically
    if (job.status === "paused") {
      await supabaseAdmin
        .from("report_email_jobs")
        .update({ status: "running", paused_reason: null })
        .eq("id", job_id)
        .eq("org_id", organization_id);
    }

    // Use singleton browser; never close it here
    const browser: Browser = await launchBrowser();

    let processedNow = 0;

    for (const r of targets) {
      // claim row
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("report_email_job_recipients")
        .update({ status: "processing" })
        .eq("job_id", job_id)
        .eq("idx", r.idx)
        .eq("status", "pending")
        .select("idx")
        .maybeSingle<{ idx: number }>();

      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) continue;

      processedNow += 1;

      const to = String(r.to_email ?? "").trim().toLowerCase();

      try {
        // validate email
        if (!to || !isValidEmail(to)) {
          await supabaseAdmin
            .from("report_email_job_recipients")
            .update({
              status: "skipped",
              error: "Invalid email",
              sent_at: new Date().toISOString(),
            })
            .eq("job_id", job_id)
            .eq("idx", r.idx);
          continue;
        }

        // Burst / quota checks (per recipient)
        const burst = await assertBurstLimit(organization_id, 1);
        if (!burst.ok) {
          await supabaseAdmin
            .from("report_email_jobs")
            .update({ status: "paused", paused_reason: "burst_limit" })
            .eq("id", job_id)
            .eq("org_id", organization_id);

          await supabaseAdmin
            .from("report_email_job_recipients")
            .update({ status: "pending" })
            .eq("job_id", job_id)
            .eq("idx", r.idx)
            .eq("status", "processing");

          const counts = await computeJobCounts(job_id);
          return NextResponse.json<OkJson>({
            ok: true,
            status: "paused",
            paused_reason: "burst_limit",
            total: Number(job.total ?? 0),
            sent_success: counts.ok,
            sent_failure: counts.fail + counts.skipped,
            processed_now: processedNow,
            done: false,
          });
        }

        const quota = await assertMonthlyQuota(organization_id, 1);
        if (!quota.ok) {
          await supabaseAdmin
            .from("report_email_jobs")
            .update({ status: "paused", paused_reason: "monthly_quota" })
            .eq("id", job_id)
            .eq("org_id", organization_id);

          await supabaseAdmin
            .from("report_email_job_recipients")
            .update({ status: "pending" })
            .eq("job_id", job_id)
            .eq("idx", r.idx)
            .eq("status", "processing");

          const counts = await computeJobCounts(job_id);
          return NextResponse.json<OkJson>({
            ok: true,
            status: "paused",
            paused_reason: "monthly_quota",
            total: Number(job.total ?? 0),
            sent_success: counts.ok,
            sent_failure: counts.fail + counts.skipped,
            processed_now: processedNow,
            done: false,
          });
        }

        if (!r.member_id) throw new Error("Missing member_id for recipient");

        const baseBody: Omit<RunMemberGivingBody, "mode"> = {
          organization_id,
          member_id: r.member_id,
          start_date: job.start_date,
          end_date: job.end_date,
          service_ids: job.service_ids ?? undefined,
          category_ids: job.category_ids ?? undefined,
          payment_methods: (job.payment_methods as PaymentMethod[] | null) ?? undefined,
        };

        const filtersLine = buildFiltersLine(baseBody);

        const attachments = [...uploadAttachments];

        // Make ONE page per recipient; reuse for summary + detailed
        let page: Page | null = null;
        try {
          page = await browser.newPage();
          page.setDefaultTimeout(30_000);
          page.setDefaultNavigationTimeout(30_000);

          if (job.attach_summary) {
            const rep = await runMemberGivingReportAsAdmin({ ...baseBody, mode: "summary" });
            const repHtml = renderMemberGivingHtml(rep, filtersLine);
            const pdfBase64 = await pdfBase64UsingPage(page, repHtml);
            const memberPart = safeFilePart(rep.member.name || "member");
            attachments.push({
              filename: `Member_Giving_Summary_${memberPart}_${job.start_date}_to_${job.end_date}.pdf`,
              content: pdfBase64,
              contentType: "application/pdf",
            });
          }

          if (job.attach_detailed) {
            const rep = await runMemberGivingReportAsAdmin({ ...baseBody, mode: "detailed" });
            const repHtml = renderMemberGivingHtml(rep, filtersLine);
            const pdfBase64 = await pdfBase64UsingPage(page, repHtml);
            const memberPart = safeFilePart(rep.member.name || "member");
            attachments.push({
              filename: `Member_Giving_Detailed_${memberPart}_${job.start_date}_to_${job.end_date}.pdf`,
              content: pdfBase64,
              contentType: "application/pdf",
            });
          }
        } finally {
          if (page) {
            try {
              await page.close();
            } catch {}
          }
        }

        const sendRes = await resend.emails.send({
          from,
          to,
          subject: campaign.subject,
          html: htmlWithCid,
          ...(job.reply_to ? { replyTo: job.reply_to } : {}),
          ...(attachments.length ? { attachments } : {}),
        });

        const providerId = sendRes.data?.id ?? null;

        if (sendRes.error) {
          const msg = sendRes.error.message;

          await supabaseAdmin
            .from("report_email_job_recipients")
            .update({
              status: "failure",
              sent_at: new Date().toISOString(),
              error: msg,
            })
            .eq("job_id", job_id)
            .eq("idx", r.idx);

          // best-effort bookkeeping
          try {
            await supabaseAdmin.from("communication_campaign_recipients").insert({
              campaign_id: campaign.id,
              to_email: to,
              success: false,
              error: msg,
              provider: "resend",
              provider_id: providerId,
            });
            await supabaseAdmin.rpc("increment_campaign_failure", { p_campaign_id: campaign.id });
          } catch {}
        } else {
          await supabaseAdmin
            .from("report_email_job_recipients")
            .update({
              status: "success",
              sent_at: new Date().toISOString(),
              error: null,
            })
            .eq("job_id", job_id)
            .eq("idx", r.idx);

          // best-effort bookkeeping + quota consumption
          try {
            await supabaseAdmin.from("communication_campaign_recipients").insert({
              campaign_id: campaign.id,
              to_email: to,
              success: true,
              error: null,
              provider: "resend",
              provider_id: providerId,
            });
            await supabaseAdmin.rpc("increment_campaign_success", { p_campaign_id: campaign.id });
            await consumeBurst(organization_id, 1);
            await consumeMonthlyQuota(organization_id, 1);
          } catch {}
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Send failed";

        await supabaseAdmin
          .from("report_email_job_recipients")
          .update({
            status: "failure",
            sent_at: new Date().toISOString(),
            error: msg,
          })
          .eq("job_id", job_id)
          .eq("idx", r.idx);
      }
    }

    // After processing batch, compute truth + update job
    const counts = await computeJobCounts(job_id);

    await supabaseAdmin
      .from("report_email_jobs")
      .update({
        status: counts.doneNow ? "done" : "running",
        paused_reason: null,
        sent_success: counts.ok,
        sent_failure: counts.fail + counts.skipped,
      })
      .eq("id", job_id)
      .eq("org_id", organization_id);

    return NextResponse.json<OkJson>({
      ok: true,
      status: counts.doneNow ? "done" : "running",
      paused_reason: null,
      total: Number(job.total ?? 0),
      sent_success: counts.ok,
      sent_failure: counts.fail + counts.skipped,
      processed_now: processedNow,
      done: counts.doneNow,
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  } finally {
    // Release lock only if we own it
    if (lockOwner && organization_id && job_id) {
      try {
        await supabaseAdmin
          .from("report_email_jobs")
          .update({ pump_locked_at: null, pump_locked_by: null })
          .eq("id", job_id)
          .eq("org_id", organization_id)
          .eq("pump_locked_by", lockOwner);
      } catch {}
    }
  }
}
