import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

type Params = { params: Promise<{ campaignId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const actorId = await requireActorId(req);
    const { campaignId } = await params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const expiryMode = String(body?.expiry_mode ?? "").trim();
    const expiresOn =
      expiryMode === "date" ? String(body?.expires_on ?? "").trim() : null;

    if (!campaignId || !["never", "date"].includes(expiryMode)) {
      return NextResponse.json({ error: "Invalid expiration option" }, { status: 400 });
    }
    if (expiryMode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn ?? "")) {
      return NextResponse.json({ error: "Choose an expiration date" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc(
      "update_intake_campaign_expiry",
      {
        p_campaign_id: campaignId,
        p_actor_id: actorId,
        p_expiry_mode: expiryMode,
        p_expires_on: expiresOn,
      },
    );

    if (error) {
      const status = error.message.includes("Forbidden")
        ? 403
        : error.message.includes("not found")
          ? 404
          : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ ok: true, campaign: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const actorId = await requireActorId(req);
    const { campaignId } = await params;
    if (!campaignId) {
      return NextResponse.json({ error: "Campaign is required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc("delete_intake_campaign_link", {
      p_campaign_id: campaignId,
      p_actor_id: actorId,
    });

    if (error) {
      const status = error.message.includes("Forbidden")
        ? 403
        : error.message.includes("not found")
          ? 404
          : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
