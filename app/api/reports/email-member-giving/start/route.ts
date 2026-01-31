export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, requireOrgOwnerOrAdmin } from "@/lib/serverAuthz";

type ErrorJson = { error: string };
type OkJson = { ok: true; job_id: string; campaign_id: string; total: number };

type UploadIn = {
  upload_id: string;
  upload_mode: "inline" | "attachment";
  inline_cid?: string;
};

type Body = {
  organization_id?: string;

  // email
  subject?: string;
  body_html?: string;
  reply_to?: string | null;
  uploads?: UploadIn[];

  // recipients
  member_ids?: string[];

  // report settings
  start_date?: string; // YYYY-MM-DD
  end_date?: string;   // YYYY-MM-DD
  service_ids?: string[];
  category_ids?: string[];
  payment_methods?: Array<"cash" | "cheque" | "online">;

  attach_summary?: boolean;
  attach_detailed?: boolean;
};

function isValidEmailMode(v: unknown): v is "inline" | "attachment" {
  return v === "inline" || v === "attachment";
}

function isValidEmail(v: string) {
  const s = v.trim();
  return s.includes("@") && s.length <= 254;
}

export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok) return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });

    const body = (await req.json().catch(() => null)) as Body | null;

    const organization_id = String(body?.organization_id ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const body_html = String(body?.body_html ?? "").trim();

    const start_date = String(body?.start_date ?? "").trim();
    const end_date = String(body?.end_date ?? "").trim();

    const attach_summary = body?.attach_summary !== false;
    const attach_detailed = body?.attach_detailed !== false;

    const replyToRaw = body?.reply_to === null ? "" : String(body?.reply_to ?? "").trim();
    const reply_to = replyToRaw ? replyToRaw.toLowerCase() : null;

    const member_ids = Array.isArray(body?.member_ids) ? body!.member_ids!.map(String) : [];

    if (!organization_id) return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    if (!subject) return NextResponse.json({ error: "subject required" }, { status: 400 });
    if (!body_html) return NextResponse.json({ error: "body_html required" }, { status: 400 });
    if (!start_date || !end_date) return NextResponse.json({ error: "start_date and end_date required" }, { status: 400 });
    if (!member_ids.length) return NextResponse.json({ error: "member_ids required" }, { status: 400 });

    if (reply_to && !isValidEmail(reply_to)) {
      return NextResponse.json({ error: "reply_to invalid" }, { status: 400 });
    }

    const authz = await requireOrgOwnerOrAdmin(organization_id, u.userId);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

    // ---- Fetch members (must have emails) ----
    // NOTE: adjust column name if yours differs (email/contact_email/etc.)
    const { data: members, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, first_name, last_name, email")
      .eq("org_id", organization_id)
      .in("id", member_ids);

    if (memErr) throw new Error(memErr.message);

    const rows = (members ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>;

    const recipients = rows
      .map((m) => {
        const email = String(m.email ?? "").trim().toLowerCase();
        const display = [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || null;
        return { member_id: m.id, to_email: email, display_name: display };
      })
      .filter((r) => r.to_email && isValidEmail(r.to_email));

    if (!recipients.length) {
      return NextResponse.json({ error: "No valid recipient emails found for selected members." }, { status: 400 });
    }

    // ---- Create campaign (reuse your create logic style) ----
    const { data: camp, error: campErr } = await supabaseAdmin
      .from("communication_campaigns")
      .insert({
        organization_id,
        subject,
        body_html,
        status: "draft",
        total_recipients: recipients.length,
        created_by: u.userId,
      })
      .select("id")
      .single<{ id: string }>();

    if (campErr) throw new Error(campErr.message);
    const campaign_id = camp.id;

    // ---- Link uploads to campaign (same as your campaign/create route) ----
    const uploads = Array.isArray(body?.uploads) ? body!.uploads! : [];
    const normalized = uploads
      .map((x) => ({
        upload_id: String(x.upload_id ?? "").trim(),
        upload_mode: x.upload_mode,
        inline_cid: x.inline_cid ? String(x.inline_cid).trim() : null,
      }))
      .filter((x) => x.upload_id && isValidEmailMode(x.upload_mode));

    if (normalized.length) {
      const ids = normalized.map((x) => x.upload_id);

      const { error: upErr } = await supabaseAdmin
        .from("message_uploads")
        .update({ campaign_id })
        .in("id", ids)
        .eq("org_id", organization_id);

      if (upErr) throw new Error(upErr.message);

      for (const row of normalized) {
        const { error } = await supabaseAdmin
          .from("message_uploads")
          .update({
            upload_mode: row.upload_mode,
            inline_cid: row.upload_mode === "inline" ? row.inline_cid : null,
          })
          .eq("id", row.upload_id)
          .eq("org_id", organization_id);

        if (error) throw new Error(error.message);
      }
    }

    // ---- Create job ----
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("report_email_jobs")
      .insert({
        org_id: organization_id,
        campaign_id,
        created_by: u.userId,
        status: "running",
        total: recipients.length,

        start_date,
        end_date,
        service_ids: body?.service_ids?.length ? body.service_ids : null,
        category_ids: body?.category_ids?.length ? body.category_ids : null,
        payment_methods: body?.payment_methods?.length ? body.payment_methods.map(String) : null,

        attach_summary,
        attach_detailed,
        reply_to,
      })
      .select("id")
      .single<{ id: string }>();

    if (jobErr) throw new Error(jobErr.message);

    const job_id = job.id;

    // ---- Create recipient queue ----
    const queue = recipients.map((r, idx) => ({
      job_id,
      idx,
      member_id: r.member_id,
      to_email: r.to_email,
      display_name: r.display_name,
      status: "pending",
    }));

    const { error: qErr } = await supabaseAdmin.from("report_email_job_recipients").insert(queue);
    if (qErr) throw new Error(qErr.message);

    return NextResponse.json<OkJson>({ ok: true, job_id, campaign_id, total: recipients.length });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
