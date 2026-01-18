import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";
import { Resend } from "resend";

type Role = "owner" | "admin" | "finance" | "member";

const resend = new Resend(process.env.RESEND_API_KEY);

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

  const email = String(invited_email).toLowerCase().trim();

  const nowIso = new Date().toISOString();
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("invites")
    .select("token, expires_at")
    .eq("organization_id", organization_id)
    .eq("invited_email", email)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 400 });
  }

  let token = existing?.token;
  let reused = true;

  if (!token) {
    token = crypto.randomUUID();

    const { error } = await supabaseAdmin.from("invites").insert({
      token,
      organization_id,
      invited_email: email,
      role: role || "member",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    reused = false;
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${token}`;
  // ---- SEND EMAIL ----
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM!,
      to: email,
      subject: "You’ve been invited to join Church Admin",
      html: `
      <div style="
        font-family: system-ui, -apple-system, Segoe UI, Roboto;
        line-height:1.6;
        color:#111827;
      ">
        <h2 style="margin-bottom:12px;">You’re invited</h2>

        <p style="margin:0 0 12px;">
          You’ve been invited to join an organization on <strong>Church Admin</strong>
          to help manage church records and administration.
        </p>

        <p style="margin:0 0 20px;">
          Click the button below to accept your invitation and get started.
        </p>

        <p style="margin:0 0 24px;">
          <a
            href="${inviteUrl}"
            style="
              display:inline-block;
              background:#0f172a;
              color:#ffffff;
              padding:12px 16px;
              border-radius:14px;
              text-decoration:none;
              font-weight:600;
            "
          >
            Accept invitation
          </a>
        </p>

        <p style="margin:0 0 8px; font-size:13px; color:#6b7280;">
          This invitation link will expire in 7 days.
        </p>

        <p style="font-size:12px; color:#9ca3af;">
          If you weren’t expecting this invitation, you can safely ignore this email.
        </p>
      </div>
    `,
    });
  } catch (e) {
    // Invite still exists; UI can show link fallback
    return NextResponse.json({
      inviteUrl,
      reused,
      emailed: false,
      warning: "Invite created but email failed to send.",
    });
  }

  return NextResponse.json({ inviteUrl, reused, emailed: true });
}
