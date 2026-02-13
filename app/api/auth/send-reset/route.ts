import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Resend } from "resend";

export async function POST(req: Request) {
  try {
    const { email, orgId } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOrgId = typeof orgId === "string" ? orgId : "";

    const reqOrigin = new URL(req.url).origin;

    const origin = reqOrigin.replace(/\/$/, "");

    const next = `/auth/update-password?orgId=${encodeURIComponent(
      cleanOrgId,
    )}&email=${encodeURIComponent(cleanEmail)}`;

    // Generate secure Supabase recovery link
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: cleanEmail,
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error || !data?.properties?.action_link) {
      // Never reveal if user exists
      return NextResponse.json({ ok: true });
    }

    const actionLink = data.properties.action_link;

    // Send via Resend
    const resend = new Resend(process.env.RESEND_API_KEY!);

    await resend.emails.send({
      from: process.env.RESEND_FROM!,
      to: cleanEmail,
      subject: "Reset your Church Admin password 9",
      html: `
        <div style="font-family:ui-sans-serif,system-ui;line-height:1.5">
          <h2 style="margin:0 0 12px">Reset your password</h2>
          <p style="margin:0 0 16px">
            Click the button below to choose a new password.
          </p>
          <p style="margin:0 0 20px">
            <a href="${actionLink}"
               style="display:inline-block;background:#111827;color:#fff;padding:12px 16px;border-radius:12px;text-decoration:none;">
              Reset password
            </a>
          </p>
          <p style="margin:0;color:#6b7280;font-size:12px">
            If you didn’t request this, you can ignore this email.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Always return success (avoid email enumeration attacks)
    return NextResponse.json({ ok: true });
  }
}
