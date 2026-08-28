import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";
import { sendManagedEmail } from "@/lib/server/email";

type Role = "owner" | "admin" | "finance" | "member";
type InviteRole = Exclude<Role, "owner">;

type PendingInvite = {
  id: string;
  token: string;
  expires_at: string;
};

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function escapeHtml(input: string) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatFrom(displayName: string, fromEmail: string) {
  // prevent header injection / weird quoting issues
  const cleanName = String(displayName).replace(/[\r\n"]/g, " ").trim();
  return `${cleanName} <${fromEmail}>`;
}

function renderInviteEmail(opts: {
  orgName: string;
  inviteUrl: string;
  expiresDays: number;
  appName?: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const inviteUrl = opts.inviteUrl; // keep raw for href
  const expiresDays = opts.expiresDays;
  const appName = escapeHtml(opts.appName ?? "Church Admin");

  const preheader = `You’ve been invited to join ${opts.orgName}.`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>You’re invited</title>
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
                <div style="font-size:18px;font-weight:800;margin:0 0 12px 0;">You’re invited!</div>

                <div style="font-size:14px;line-height:1.7;color:#334155;margin:0 0 14px 0;">
                  You’ve been invited to join <strong>${orgName}</strong> on ${appName}.
                  Accepting this invite will give you access to the organization workspace.
                </div>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 8px 0;">
                  <tr>
                    <td bgcolor="#111827" style="border-radius:12px;">
                      <a href="${inviteUrl}"
                         style="display:inline-block;padding:12px 16px;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:12px;">
                        Accept invitation
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="font-size:12px;line-height:1.6;color:#64748b;margin-top:14px;">
                  This invitation link expires in ${expiresDays} days.
                </div>

                <div style="font-size:12px;line-height:1.6;color:#64748b;margin-top:10px;">
                  If the button doesn’t work, copy and paste this link:
                  <div style="word-break:break-all;color:#475569;margin-top:6px;">
                    ${escapeHtml(inviteUrl)}
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 6px 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#94a3b8;font-size:12px;line-height:1.5;">
                If you weren’t expecting this invitation, you can safely ignore this email.
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
  const { organization_id, invited_email, role } = await req.json();

  if (!organization_id || !invited_email) {
    return NextResponse.json(
      { error: "organization_id and invited_email are required" },
      { status: 400 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(
    accessToken
  );

  if (userErr || !userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = userRes.user.id;

  const { data: membership, error: memErr } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organization_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 400 });
  }

  const myRole = (membership?.role ?? null) as Role | null;
  if (myRole !== "admin" && myRole !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch org name for dynamic "From"
  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("name")
    .eq("id", organization_id)
    .maybeSingle();

  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 400 });
  }

  const orgName = String(org?.name ?? "Church Admin").trim() || "Church Admin";

  const email = String(invited_email).toLowerCase().trim();
  const inviteRole = String(role ?? "member") as InviteRole;
  if (!["member", "finance", "admin"].includes(inviteRole)) {
    return NextResponse.json({ error: "Invalid invite role." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const nextExpiryIso = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("invites")
    .select("id, token, expires_at")
    .eq("organization_id", organization_id)
    .eq("invited_email", email)
    .is("used_at", null)
    .maybeSingle<PendingInvite>();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 400 });
  }

  let token: string;
  let reused = false;
  let refreshed = false;

  if (existing) {
    const expired = new Date(existing.expires_at).getTime() <= new Date(nowIso).getTime();
    token = expired ? crypto.randomUUID() : existing.token;
    const { error: updateError } = await supabaseAdmin
      .from("invites")
      .update({
        token,
        role: inviteRole,
        ...(expired ? { expires_at: nextExpiryIso, created_at: nowIso } : {}),
      })
      .eq("id", existing.id)
      .is("used_at", null);

    if (updateError) {
      return NextResponse.json(
        { error: "We couldn't refresh the existing invitation. Please try again." },
        { status: 409 },
      );
    }
    reused = !expired;
    refreshed = expired;
  } else {
    token = crypto.randomUUID();
    const { error: insertError } = await supabaseAdmin.from("invites").insert({
      token,
      organization_id,
      invited_email: email,
      role: inviteRole,
      expires_at: nextExpiryIso,
    });

    if (insertError?.code === "23505") {
      return NextResponse.json(
        { error: "An invitation for this email is already pending. Refresh the users list and resend or remove it." },
        { status: 409 },
      );
    }
    if (insertError?.message?.includes("PLAN_CAPACITY_REACHED")) {
      return NextResponse.json(
        { error: "This organization has reached its management-seat limit." },
        { status: 409 },
      );
    }
    if (insertError) {
      return NextResponse.json(
        { error: "We couldn't create the invitation. Please try again." },
        { status: 400 },
      );
    }
  }

  const base = String(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const inviteUrl = `${base}/invite/${token}`;

  // Dynamic sender display name, static verified sender email
  const fromEmailOnly = process.env.RESEND_FROM!;
  const from = formatFrom(orgName, fromEmailOnly);

  const html = renderInviteEmail({
    orgName,
    inviteUrl,
    expiresDays: 7,
    appName: "Church Admin",
  });

  try {
    const emailResult = await sendManagedEmail({
      kind: "essential",
      from,
      to: email,
      subject: `You’re invited to join ${orgName}`,
      html,
      tags: [{ name: "message_type", value: "invitation" }],
    });
    if (!emailResult.sent) throw new Error(emailResult.skipped ? emailResult.reason : emailResult.error);
  } catch {
    // Invite still exists; UI can show link fallback
    return NextResponse.json({
      inviteUrl,
      reused,
      refreshed,
      emailed: false,
      warning: "Invite created but email failed to send.",
    });
  }

  return NextResponse.json({ inviteUrl, reused, refreshed, emailed: true });
}
