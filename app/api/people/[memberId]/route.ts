import { NextResponse } from "next/server";
import { requireActorId } from "@/lib/server/authUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = { params: Promise<{ memberId: string }> };

function responseStatus(message: string) {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "Forbidden") return 403;
  if (message === "PERSON_TARGET_INVALID") return 404;
  return 400;
}

export async function PATCH(req: Request, route: RouteContext) {
  try {
    const actorId = await requireActorId(req);
    const { memberId } = await route.params;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !["values", "custom_values"].includes(key))) {
      throw new Error("Invalid request");
    }
    if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)
      || !Array.isArray(body.custom_values)) {
      throw new Error("Invalid request");
    }

    const { error } = await supabaseAdmin.rpc("update_member_with_custom_fields", {
      p_member_id: memberId,
      p_actor_id: actorId,
      p_values: body.values,
      p_custom_values: body.custom_values,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to update member.";
    return NextResponse.json({ error: message }, { status: responseStatus(message) });
  }
}
