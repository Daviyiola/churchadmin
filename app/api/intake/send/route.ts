import { NextResponse } from "next/server";
import crypto from "crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

const resend = new Resend(process.env.RESEND_API_KEY!);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addDaysTS(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Slightly safer: keep a verified email address in env, only vary display name
function formatFrom(displayName: string, fromEmail: string) {
  // Prevent header weirdness if org name contains quotes/newlines
  const cleanName = displayName.replace(/[\r\n"]/g, " ").trim();
  return `${cleanName} <${fromEmail}>`;
}

function renderIntakeEmail(opts: {
  orgName: string;
  firstName: string;
  intakeUrl: string;
  expiresInDays: number;
  appName?: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const firstName = escapeHtml(opts.firstName);
  const intakeUrl = opts.intakeUrl; // keep raw for href
  const expiresInDays = opts.expiresInDays;
  const appName = escapeHtml(opts.appName ?? "Church Admin");

  const preheader = `Complete your guest form for ${opts.orgName}.`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Complete your guest form</title>
  </head>
  <body style="margin:0;background:#f6f7fb;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="padding:10px 6px 18px 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
                <div style="font-size:13px;color:#64748b;"> </div>
              </td>
            </tr>

            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a;">
                <div style="font-size:18px;font-weight:700;margin:0 0 10px 0;">Hi ${firstName},</div>

                <div style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px 0;">
                  We are so glad you were able to stop by and worship with us today at <strong>${orgName}</strong>.
                  Please take a moment to complete our guest form. We would love to stay in touch.
                </div>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 8px 0;">
                  <tr>
                    <td bgcolor="#111827" style="border-radius:12px;">
                      <a href="${intakeUrl}"
                         style="display:inline-block;padding:12px 16px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">
                        Complete guest form
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="font-size:12px;line-height:1.6;color:#64748b;margin-top:14px;">
                  This secure link expires in ${expiresInDays} days.
                </div>

                <div style="font-size:12px;line-height:1.6;color:#64748b;margin-top:10px;">
                  If the button doesn’t work, copy and paste this link:
                  <div style="word-break:break-all;color:#475569;margin-top:6px;">
                    ${escapeHtml(intakeUrl)}
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 6px 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#94a3b8;font-size:12px;line-height:1.5;">
                Sent via ${appName}. If you didn’t request this, you can ignore this email.
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const body = await req.json().catch(() => null);
    const orgId = String(body?.org_id ?? "").trim();
    const firstName = String(body?.first_name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!orgId) return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
    if (!firstName)
      return NextResponse.json({ error: "First name is required" }, { status: 400 });
    if (!email || !email.includes("@"))
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

    // Permission check
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("user_id", actorId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });
    if (!link)
      return NextResponse.json(
        { error: "Forbidden: you are not linked to this organization." },
        { status: 403 },
      );
    if (!["owner", "admin", "finance"].includes(String(link.role)))
      return NextResponse.json({ error: "Forbidden: insufficient role." }, { status: 403 });

    // Fetch org name for dynamic "From"
    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();

    if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 400 });

    const orgName = String(org?.name ?? "Church Admin").trim() || "Church Admin";

    // Create member
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("members")
      .insert({
        org_id: orgId,
        membership_stage: "visitor",
        profile_complete: false,

        first_name: firstName,
        last_name: "_", // schema requires NOT NULL
        email,
        phone: null,

        gender: null,
        age_group: null,
        segment: null,
        address: null,
        marital_status: null,
        children_count: null,
        status: "active",

        created_by: actorId,
        updated_by: actorId,
      })
      .select("id")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    const memberId = inserted.id as string;

    const { error: vdErr } = await supabaseAdmin.from("visitor_details").upsert(
      {
        member_id: memberId,
        first_visit_at: todayISO(),
        follow_up_status: "new",
        next_follow_up_at: addDaysISO(3),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id" },
    );
    if (vdErr) return NextResponse.json({ error: vdErr.message }, { status: 400 });

    // expire old tokens for this member
    await supabaseAdmin
      .from("intake_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .is("used_at", null);

    const token = makeToken();
    const expiresAt = addDaysTS(3);

    const { error: tokErr } = await supabaseAdmin.from("intake_tokens").insert({
      token,
      org_id: orgId,
      member_id: memberId,
      invited_email: email,
      expires_at: expiresAt,
      used_at: null,
      created_by: actorId,
    });
    if (tokErr) return NextResponse.json({ error: tokErr.message }, { status: 400 });

    const base = process.env.NEXT_PUBLIC_APP_URL!.replace(/\/$/, "");
    const intakeUrl = `${base}/intake/${token}`;

    const fromEmailOnly = process.env.RESEND_FROM!;
    const from = formatFrom(orgName, fromEmailOnly);

    const html = renderIntakeEmail({
      orgName,
      firstName,
      intakeUrl,
      expiresInDays: 3,
      appName: "Church Admin",
    });

    await resend.emails.send({
      from,
      to: email,
      subject: `Complete your guest form – ${orgName}`,
      html,
    });

    return NextResponse.json({ ok: true, intakeUrl, emailed: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";

    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
