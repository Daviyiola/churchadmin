import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

export async function POST(req: Request) {
  try {
    const actorId = await requireActorId(req);
    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (!bodyUnknown || typeof bodyUnknown !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const body = bodyUnknown as Record<string, unknown>;

    const { error } = await supabaseAdmin.rpc("create_first_timer_visitor", {
      p_org_id: String(body.org_id ?? "").trim(),
      p_actor_id: actorId,
      p_first_name: String(body.first_name ?? "").trim(),
      p_last_name: String(body.last_name ?? "").trim(),
      p_email: String(body.email ?? "").trim() || null,
      p_phone: String(body.phone ?? "").trim(),
      p_gender: body.gender,
      p_age_group: body.age_group,
      p_address: String(body.address ?? "").trim() || null,
      p_marital_status: String(body.marital_status ?? "").trim() || null,
      p_children_count: body.children_count ?? null,
      p_first_visit_at: body.first_visit_at || null,
      p_how_heard: String(body.how_heard ?? "").trim() || null,
      p_prayer_request_tags: Array.isArray(body.prayer_request_tags)
        ? body.prayer_request_tags
        : null,
      p_follow_up_notes: String(body.follow_up_notes ?? "").trim() || null,
      p_next_follow_up_at: body.next_follow_up_at || null,
    });

    if (error) {
      const forbidden = error.message.includes("Only finance, admin, or owner");
      return NextResponse.json(
        { error: forbidden ? "Forbidden" : error.message },
        { status: forbidden ? 403 : 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
