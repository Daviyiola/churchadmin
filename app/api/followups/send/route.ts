import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import {
  assertBurstLimit,
  consumeBurst,
  assertMonthlyQuota,
  consumeMonthlyQuota,
} from "@/lib/server/communicationsLimits";

export const runtime = "nodejs";

const resend = new Resend(process.env.RESEND_API_KEY!);

type ErrorJson = { error: string };
type OkJson = { ok: true; provider_id: string | null };

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Keep "from" as a verified email; only vary display name
function formatFrom(displayName: string, fromEmail: string) {
  const cleanName = displayName.replace(/[\r\n"]/g, " ").trim();
  return `${cleanName} <${fromEmail}>`;
}

function renderFollowUpEmail(opts: {
  orgName: string;
  subject: string;
  bodyText: string; // plaintext with \n
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

export async function POST(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const body = (await req.json().catch(() => null)) as
      | {
          member_id?: string;
          to?: string;
          reply_to?: string | null;
          subject?: string;
          body?: string;
        }
      | null;

    const memberId = String(body?.member_id ?? "").trim();
    const to = String(body?.to ?? "").trim().toLowerCase();
    const replyToRaw =
      body?.reply_to === null ? "" : String(body?.reply_to ?? "").trim();
    const replyTo = replyToRaw ? replyToRaw.toLowerCase() : "";
    const subject = String(body?.subject ?? "").trim();
    const msgBody = String(body?.body ?? "").trim();

    if (!memberId)
      return NextResponse.json<ErrorJson>(
        { error: "Missing member_id" },
        { status: 400 },
      );
    if (!to || !isValidEmail(to))
      return NextResponse.json<ErrorJson>(
        { error: "A valid 'to' is required" },
        { status: 400 },
      );
    if (replyTo && !isValidEmail(replyTo))
      return NextResponse.json<ErrorJson>(
        { error: "Reply-to must be a valid email (or blank)" },
        { status: 400 },
      );
    if (!subject)
      return NextResponse.json<ErrorJson>(
        { error: "Subject is required" },
        { status: 400 },
      );
    if (!msgBody)
      return NextResponse.json<ErrorJson>(
        { error: "Body is required" },
        { status: 400 },
      );

    // Fetch member (org_id)
    const { data: member, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, org_id, email")
      .eq("id", memberId)
      .maybeSingle<{ id: string; org_id: string | null; email: string | null }>();

    if (memErr)
      return NextResponse.json<ErrorJson>(
        { error: memErr.message },
        { status: 400 },
      );
    if (!member)
      return NextResponse.json<ErrorJson>(
        { error: "Member not found" },
        { status: 404 },
      );

    const orgId = String(member.org_id ?? "").trim();
    if (!orgId)
      return NextResponse.json<ErrorJson>(
        { error: "Member missing org_id" },
        { status: 400 },
      );

    // Permission: actor must be linked to org with owner/admin/finance
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("user_id", actorId)
      .eq("organization_id", orgId)
      .maybeSingle<{ role: string | null }>();

    if (linkErr)
      return NextResponse.json<ErrorJson>(
        { error: linkErr.message },
        { status: 400 },
      );
    if (!link)
      return NextResponse.json<ErrorJson>(
        { error: "Forbidden: not linked to this organization" },
        { status: 403 },
      );

    const role = String(link.role ?? "");
    if (!["owner", "admin", "finance"].includes(role))
      return NextResponse.json<ErrorJson>(
        { error: "Forbidden: insufficient role" },
        { status: 403 },
      );

    // ---- Quota checks (shared system) ----
    const burst = await assertBurstLimit(orgId, 1);
    if (!burst.ok)
      return NextResponse.json<ErrorJson>({ error: burst.error }, { status: 429 });

    const quota = await assertMonthlyQuota(orgId, 1);
    if (!quota.ok)
      return NextResponse.json<ErrorJson>({ error: quota.error }, { status: 402 });

    // Org name for From
    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle<{ name: string | null }>();

    if (orgErr)
      return NextResponse.json<ErrorJson>(
        { error: orgErr.message },
        { status: 400 },
      );

    const orgName = String(org?.name ?? "Our Church").trim() || "Our Church";
    const from = formatFrom(orgName, process.env.RESEND_FROM!);

    const html = renderFollowUpEmail({
      orgName,
      subject,
      bodyText: msgBody,
      appName: "Church Admin",
    });

    // Send
    const sendRes = await resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });

    if (sendRes.error) {
      return NextResponse.json<ErrorJson>(
        { error: sendRes.error.message },
        { status: 400 },
      );
    }

    const resendId = sendRes.data?.id ?? null;

    // Consume AFTER success (so you don't burn quota on provider failure)
    await consumeBurst(orgId, 1);
    await consumeMonthlyQuota(orgId, 1);

    // Update visitor_details follow_up_status → contacted
    await supabaseAdmin.from("visitor_details").upsert(
      {
        member_id: memberId,
        follow_up_status: "contacted",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id" },
    );

    // Log followup
    await supabaseAdmin.from("followup_emails").insert({
      org_id: orgId,
      member_id: memberId,
      to_email: to,
      reply_to: replyTo || null,
      subject,
      body: msgBody,
      provider: "resend",
      provider_id: resendId,
      sent_by: actorId,
    });

    return NextResponse.json<OkJson>({ ok: true, provider_id: resendId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json<ErrorJson>({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json<ErrorJson>({ error: msg }, { status: 400 });
  }
}
