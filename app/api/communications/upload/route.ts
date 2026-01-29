import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

export const runtime = "nodejs";

type ErrorJson = { error: string };

type UploadRow = {
  id: string;
  bucket: string;
  path: string;
  filename: string;
  content_type: string;
  bytes: number;

  upload_mode: string | null;
  inline_cid: string | null;
  preview_url: string | null;
  campaign_id: string | null;
};

type OkJson = {
  ok: true;
  upload: UploadRow;
  signed_url: string;
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice("Bearer ".length) : null;
}

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

async function assertCanSendCommunications(
  organizationId: string,
  accessToken: string,
): Promise<{ userId: string } | { error: string }> {
  const { data: userRes, error: userErr } =
    await supabaseAdmin.auth.getUser(accessToken);

  if (userErr || !userRes?.user?.id) return { error: "Unauthorized" };
  const userId = userRes.user.id;

  const { data: link, error: linkErr } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (linkErr) return { error: linkErr.message };
  if (!link) return { error: "No access to this organization." };

  const role = link.role as Role;
  if (role !== "owner" && role !== "admin") {
    return { error: "Only owners/admins can upload communications." };
  }

  return { userId };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json<ErrorJson>(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const form = await req.formData();

    const campaign_id_raw = form.get("campaign_id");
    const campaign_id =
      typeof campaign_id_raw === "string" && campaign_id_raw.trim()
        ? campaign_id_raw.trim()
        : null;

    const organization_id = String(form.get("organization_id") ?? "");
    const file = form.get("file");

    if (!organization_id) {
      return NextResponse.json<ErrorJson>(
        { error: "organization_id required" },
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json<ErrorJson>(
        { error: "file required" },
        { status: 400 },
      );
    }

    const can = await assertCanSendCommunications(organization_id, token);
    if ("error" in can) {
      return NextResponse.json<ErrorJson>(
        { error: can.error },
        { status: 403 },
      );
    }

    const bucket = "message-uploads";
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const id = crypto.randomUUID();
    const path = `org/${organization_id}/${id}/${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const up = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (up.error) throw new Error(up.error.message);

    /**
     * IMPORTANT:
     * Your DB table currently has: org_id + uploaded_by NOT NULL.
     * Even if the client uses organization_id, we can map it here.
     *
     * If you have already renamed the column to organization_id in DB,
     * then change `org_id:` below to `organization_id:`.
     */
    const upload_mode = String(form.get("upload_mode") ?? "inline"); // or default "attachment"
    const inline_cid = upload_mode === "inline" ? crypto.randomUUID() : null;

    const signed = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60);
    if (signed.error) throw new Error(signed.error.message);

    const preview_url = signed.data.signedUrl;

    const { data: row, error: insErr } = await supabaseAdmin
      .from("message_uploads")
      .insert({
        id,
        org_id: organization_id,
        campaign_id,
        uploaded_by: can.userId,
        bucket,
        path,
        filename: safeName,
        content_type: file.type || "application/octet-stream",
        bytes: file.size,

        upload_mode,
        inline_cid,
        preview_url,
      })
      .select(
        "id,bucket,path,filename,content_type,bytes,upload_mode,inline_cid,preview_url,campaign_id",
      )

      .single<UploadRow>();

    if (insErr) throw new Error(insErr.message);
    if (!row) throw new Error("Insert failed");

    return NextResponse.json<OkJson>({
      ok: true,
      upload: row,
      signed_url: preview_url,
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 },
    );
  }
}
