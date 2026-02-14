import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Resend } from "resend";

export async function POST(req: Request) {
  try {
    const { name, email, church, message, source, website } = await req.json();

    // Honeypot: if filled, silently succeed
    if (typeof website === "string" && website.trim().length > 0) {
      return NextResponse.json({ ok: true });
    }

    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const cleanChurch = typeof church === "string" ? church.trim() : "";
    const cleanMessage = typeof message === "string" ? message.trim() : "";
    const cleanSource = typeof source === "string" ? source.trim() : "contact-page";

    if (!cleanName || !cleanMessage) {
      return NextResponse.json(
        { error: "Name and message are required." },
        { status: 400 },
      );
    }

    const fromEmail = process.env.RESEND_FROM!;
    const fromName = "Church Admin";
    const toEmail =
      process.env.CONTACT_TO_EMAIL || "davidiyiola15@gmail.com";

    // Store to Supabase (recommended)
    // NOTE: create table public.contact_messages (I gave you the SQL earlier)
    try {
      await supabaseAdmin
        .from("contact_messages")
        .insert({
          name: cleanName,
          email: cleanEmail || null,
          church: cleanChurch || null,
          message: cleanMessage,
          source: cleanSource,
          user_agent: req.headers.get("user-agent"),
          ip:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null,
        });
    } catch {
      // Don't fail the whole request if DB insert fails
    }

    // Email you via Resend
    const resend = new Resend(process.env.RESEND_API_KEY!);

    const subject = `New Contact Message${cleanChurch ? ` — ${cleanChurch}` : ""}`;

    const html = `
<div style="background:#f9fafb;padding:40px 20px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
    
    <!-- Header -->
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:600;color:#111827;">
        Church Admin
      </div>
      <div style="font-size:13px;color:#6b7280;">
        New contact message
      </div>
    </div>

    <!-- Body -->
    <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">
      Someone reached out from your website
    </h2>

    <div style="margin:16px 0 0;font-size:14px;color:#374151;line-height:1.6;">
      <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(cleanName)}</p>
      <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(cleanEmail || "(not provided)")}</p>
      <p style="margin:0 0 8px;"><strong>Church:</strong> ${escapeHtml(cleanChurch || "(not provided)")}</p>
      <p style="margin:0 0 8px;"><strong>Source:</strong> ${escapeHtml(cleanSource)}</p>
    </div>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

    <div style="font-size:14px;color:#111827;">
      <div style="font-weight:600;margin:0 0 8px;">Message</div>
      <div style="white-space:pre-wrap;color:#374151;">${escapeHtml(cleanMessage)}</div>
    </div>
  </div>

  <div style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;color:#9ca3af;">
    © ${new Date().getFullYear()} Church Admin
  </div>
</div>
`;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: toEmail,
      subject,
      html,
      replyTo: cleanEmail || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    // Up to you:
    // - If you want to be strict for contact form UX, return 500
    // - If you want "always ok" behavior, return ok true
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
