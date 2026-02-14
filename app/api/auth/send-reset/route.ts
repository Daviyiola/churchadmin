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

    // Prefer localhost while developing, otherwise use your configured app URL.
    const origin = reqOrigin.includes("localhost")
      ? reqOrigin
      : (process.env.NEXT_PUBLIC_APP_URL || reqOrigin).replace(/\/$/, "");

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
    const fromEmail = process.env.RESEND_FROM!;
    const fromName = "Church Admin";

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: cleanEmail,
      subject: "Reset your Church Admin password",
      html: `
  <div style="background:#f9fafb;padding:40px 20px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
      
      <!-- Header -->
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:20px;font-weight:600;color:#111827;">
          Church Admin
        </div>
        <div style="font-size:13px;color:#6b7280;">
          Church Operations Simplified
        </div>
      </div>

      <!-- Body -->
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827;">
        Reset your password
      </h2>

      <p style="margin:0 0 18px;color:#374151;font-size:14px;">
        We received a request to reset your password for your Church Admin account.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="${actionLink}"
           style="display:inline-block;background:#111827;color:#ffffff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;">
          Reset password
        </a>
      </div>

      <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">
        This link will expire automatically for security reasons.
      </p>

      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
        If the button above doesn't work, copy and paste this link into your browser:
      </p>

      <p style="word-break:break-all;font-size:12px;color:#4b5563;">
        ${actionLink}
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;" />

      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        If you did not request this password reset, you can safely ignore this email.
      </p>
    </div>

    <div style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;color:#9ca3af;">
      © ${new Date().getFullYear()} Church Admin
    </div>
  </div>
  `,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Always return success (avoid email enumeration attacks)
    return NextResponse.json({ ok: true });
  }
}
