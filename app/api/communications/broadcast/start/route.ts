import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, requireOrgFinanceOrAbove } from "@/lib/serverAuthz";

export const runtime = "nodejs";

type ErrorJson = { error: string };
type OkJson = { ok: true; campaign_id: string };

type UploadIn = {
  upload_id: string;
  upload_mode: "inline" | "attachment";
  inline_cid?: string;
};

type Body = {
  organization_id?: string;
  subject?: string;
  body_html?: string;
  total_recipients?: number;
  uploads?: UploadIn[];
};

function isValidEmailMode(v: unknown): v is "inline" | "attachment" {
  return v === "inline" || v === "attachment";
}

export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok)
      return NextResponse.json<ErrorJson>(
        { error: u.error },
        { status: u.status },
      );

    const body = (await req.json().catch(() => null)) as Body | null;

    const organization_id = String(body?.organization_id ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const body_html = String(body?.body_html ?? "").trim();
    const total_recipients = Number(body?.total_recipients ?? 0);

    if (!organization_id)
      return NextResponse.json<ErrorJson>(
        { error: "organization_id required" },
        { status: 400 },
      );
    if (!subject)
      return NextResponse.json<ErrorJson>(
        { error: "subject required" },
        { status: 400 },
      );
    if (!body_html)
      return NextResponse.json<ErrorJson>(
        { error: "body_html required" },
        { status: 400 },
      );
    if (!Number.isFinite(total_recipients) || total_recipients < 0)
      return NextResponse.json<ErrorJson>(
        { error: "total_recipients invalid" },
        { status: 400 },
      );

    const authz = await requireOrgFinanceOrAbove(organization_id, u.userId);
    if (!authz.ok)
      return NextResponse.json<ErrorJson>(
        { error: authz.error },
        { status: authz.status },
      );

    const { data: mailing, error: mailingError } = await supabaseAdmin
      .from("organization_settings")
      .select("mailing_address_line1,mailing_city,mailing_state,mailing_postal_code,mailing_country")
      .eq("organization_id", organization_id)
      .maybeSingle();
    if (mailingError) throw new Error(mailingError.message);
    if (!mailing?.mailing_address_line1 || !mailing.mailing_city || !mailing.mailing_state || !mailing.mailing_postal_code || !mailing.mailing_country) {
      return NextResponse.json<ErrorJson>(
        { error: "Add the organization mailing address in Settings before sending a broadcast." },
        { status: 409 },
      );
    }

    // 1) Create campaign
    const { data, error } = await supabaseAdmin
      .from("communication_campaigns")
      .insert({
        organization_id,
        subject,
        body_html,
        status: "draft",
        total_recipients,
        created_by: u.userId,
      })
      .select("id")
      .single<{ id: string }>();

    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("Failed to create campaign");

    const campaign_id = data.id;

    // 2) Link uploads to this campaign (so send-one can fetch attachments/inline)
    const uploads = Array.isArray(body?.uploads) ? body!.uploads! : [];
    const normalized = uploads
      .map((x) => ({
        upload_id: String(x.upload_id ?? "").trim(),
        upload_mode: x.upload_mode,
        inline_cid: x.inline_cid ? String(x.inline_cid).trim() : null,
      }))
      .filter((x) => x.upload_id && isValidEmailMode(x.upload_mode))
      .map((x) => ({
        id: x.upload_id,
        org_id: organization_id,
        campaign_id,
        upload_mode: x.upload_mode,
        inline_cid: x.upload_mode === "inline" ? x.inline_cid : null,
      }));
    if (normalized.length) {
      const ids = normalized.map((x) => x.id);

      const { error: upErr } = await supabaseAdmin
        .from("message_uploads")
        .update({
          campaign_id,
        })
        .in("id", ids)
        .eq("org_id", organization_id);

      if (upErr) throw new Error(upErr.message);

      // Now update per-row fields that differ (mode / cid)
      for (const row of normalized) {
        const { error } = await supabaseAdmin
          .from("message_uploads")
          .update({
            upload_mode: row.upload_mode,
            inline_cid: row.inline_cid,
          })
          .eq("id", row.id)
          .eq("org_id", organization_id);

        if (error) throw new Error(error.message);
      }
    }
    
    return NextResponse.json<OkJson>({ ok: true, campaign_id });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
