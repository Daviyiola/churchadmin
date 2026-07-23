import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  assertBurstLimit,
  consumeBurst,
  assertMonthlyQuota,
  consumeMonthlyQuota,
} from "@/lib/server/communicationsLimits";

export const runtime = "nodejs";

const resend = new Resend(process.env.RESEND_API_KEY!);

type ErrorJson = { error: string };

type ScheduledFollowupRow = {
  id: string;
  org_id: string;
  member_id: string;
  followup_label: string;
  subject: string;
  body: string;
  reply_to: string | null;
  scheduled_for: string;
  status: string;
};

type MemberRow = {
  id: string;
  org_id: string | null;
  email: string | null;
};

type OrgRow = {
  name: string | null;
};

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatFrom(displayName: string, fromEmail: string) {
  const cleanName = displayName.replace(/[\r\n"]/g, " ").trim();
  return `${cleanName} <${fromEmail}>`;
}

function renderFollowUpEmail(opts: {
  orgName: string;
  subject: string;
  bodyText: string;
  appName?: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const subject = escapeHtml(opts.subject);
  const appName = escapeHtml(opts.appName ?? "Church Admin");
  const bodyHtml = escapeHtml(opts.bodyText).replace(/\n/g, "<br/>");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:#f6f7fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a;">
                <div style="font-size:14px;line-height:1.7;color:#0f172a;">
                  ${bodyHtml}
                </div>
                <div style="margin-top:18px;font-size:12px;line-height:1.6;color:#64748b;">
                  Sent by <strong>${orgName}</strong> via ${appName}.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function isValidEmail(v: string) {
  const s = v.trim();
  return s.includes("@") && s.length <= 254;
}

function isCronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("CRON_SECRET is missing");
    return false;
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;

  // Helpful for localhost/manual browser testing.
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;

  console.error("Cron auth failed", {
    hasSecret: Boolean(secret),
    hasAuthHeader: Boolean(auth),
    hasQuerySecret: Boolean(url.searchParams.get("secret")),
    authPrefix: auth.slice(0, 10),
  });

  return false;
}

async function markScheduledFollowup(
  id: string,
  update: {
    status?: "sent" | "failed" | "blocked_quota";
    sent_at?: string | null;
    error_message?: string | null;
  },
) {
  await supabaseAdmin
    .from("scheduled_followups")
    .update({
      ...update,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function processOne(f: ScheduledFollowupRow) {
  const nowIso = new Date().toISOString();

  if (!f.subject.trim() || !f.body.trim()) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: "Scheduled follow-up is missing subject or body.",
    });
    return { id: f.id, status: "failed", reason: "missing_subject_or_body" };
  }

  const { data: member, error: memErr } = await supabaseAdmin
    .from("members")
    .select("id,org_id,email")
    .eq("id", f.member_id)
    .maybeSingle<MemberRow>();

  if (memErr || !member) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: memErr?.message || "Member not found.",
    });
    return { id: f.id, status: "failed", reason: "member_not_found" };
  }

  const orgId = String(member.org_id ?? f.org_id ?? "").trim();

  if (!orgId || orgId !== f.org_id) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: "Member organization mismatch.",
    });
    return { id: f.id, status: "failed", reason: "org_mismatch" };
  }

  const to = String(member.email ?? "")
    .trim()
    .toLowerCase();

  if (!to || !isValidEmail(to)) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: "Recipient has no valid email.",
    });
    return { id: f.id, status: "failed", reason: "invalid_recipient" };
  }

  const replyTo = String(f.reply_to ?? "")
    .trim()
    .toLowerCase();

  if (replyTo && !isValidEmail(replyTo)) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: "Reply-to is not a valid email.",
    });
    return { id: f.id, status: "failed", reason: "invalid_reply_to" };
  }

  const burst = await assertBurstLimit(orgId, 1);
  if (!burst.ok) {
    // Do not permanently fail. Leave pending so a later cron run can retry.
    await supabaseAdmin
      .from("scheduled_followups")
      .update({
        error_message: burst.error,
        updated_at: nowIso,
      })
      .eq("id", f.id)
      .eq("status", "pending");

    return { id: f.id, status: "pending", reason: "burst_limited" };
  }

  const quota = await assertMonthlyQuota(orgId, 1);
  if (!quota.ok) {
    await markScheduledFollowup(f.id, {
      status: "blocked_quota",
      error_message: quota.error,
    });
    return { id: f.id, status: "blocked_quota", reason: "monthly_quota" };
  }

  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle<OrgRow>();

  if (orgErr) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: orgErr.message,
    });
    return { id: f.id, status: "failed", reason: "org_lookup_failed" };
  }

  const orgName = String(org?.name ?? "Our Church").trim() || "Our Church";
  const from = formatFrom(orgName, process.env.RESEND_FROM!);

  const html = renderFollowUpEmail({
    orgName,
    subject: f.subject,
    bodyText: f.body,
    appName: "Church Admin",
  });

  const sendRes = await resend.emails.send({
    from,
    to,
    subject: f.subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });

  if (sendRes.error) {
    await markScheduledFollowup(f.id, {
      status: "failed",
      error_message: sendRes.error.message,
    });
    return { id: f.id, status: "failed", reason: "provider_error" };
  }

  const resendId = sendRes.data?.id ?? null;

  // Consume only after provider success.
  await consumeBurst(orgId, 1);
  await consumeMonthlyQuota(orgId, 1);

  await supabaseAdmin
    .from("scheduled_followups")
    .update({
      status: "sent",
      sent_at: nowIso,
      error_message: null,
      updated_at: nowIso,
    })
    .eq("id", f.id);

  const sentDate = nowIso.slice(0, 10);
  const noteLine = `Scheduled follow-up sent on ${sentDate}: ${
    f.followup_label || f.subject || "Follow-up email"
  }`;

  const { data: existingDetails } = await supabaseAdmin
    .from("visitor_details")
    .select("follow_up_notes")
    .eq("member_id", f.member_id)
    .maybeSingle<{ follow_up_notes: string | null }>();

  const prevNotes = String(existingDetails?.follow_up_notes ?? "").trim();
  const nextNotes = prevNotes ? `${prevNotes}\n${noteLine}` : noteLine;

  await supabaseAdmin.from("visitor_details").upsert(
    {
      member_id: f.member_id,
      follow_up_status: "contacted",
      follow_up_notes: nextNotes,
      updated_at: nowIso,
    },
    { onConflict: "member_id" },
  );

  // Best-effort log. Do not undo a successful send if logging fails.
  await supabaseAdmin.from("followup_emails").insert({
    org_id: orgId,
    member_id: f.member_id,
    to_email: to,
    reply_to: replyTo || null,
    subject: f.subject,
    body: f.body,
    provider: "resend",
    provider_id: resendId,
    sent_by: null,
  });

  return { id: f.id, status: "sent", provider_id: resendId };
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json<ErrorJson>(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(Math.floor(limitRaw), 50))
    : 25;

  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("scheduled_followups")
    .select(
      "id,org_id,member_id,followup_label,subject,body,reply_to,scheduled_for,status",
    )
    .eq("status", "pending")
    .is("archived_at", null)
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json<ErrorJson>(
      { error: error.message },
      { status: 400 },
    );
  }

  const due = (data ?? []) as ScheduledFollowupRow[];

  const results = [];
  for (const item of due) {
    try {
      results.push(await processOne(item));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";

      await markScheduledFollowup(item.id, {
        status: "failed",
        error_message: msg,
      });

      results.push({
        id: item.id,
        status: "failed",
        reason: msg,
      });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const blocked_quota = results.filter(
    (r) => r.status === "blocked_quota",
  ).length;
  const pending = results.filter((r) => r.status === "pending").length;

  return NextResponse.json({
    ok: true,
    checked_at: nowIso,
    due_count: due.length,
    sent,
    failed,
    blocked_quota,
    pending,
    results,
  });
}
