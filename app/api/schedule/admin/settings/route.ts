import { NextResponse } from "next/server";
import { requireActorId } from "@/lib/server/authUser";
import { requireOrgOperator } from "@/lib/schedule/admin_auth";
import { cleanStr } from "@/lib/schedule/util";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ErrorJson = { error: string };

async function authorize(req: Request, orgId: string) {
  const actorId = await requireActorId(req);
  const permission = await requireOrgOperator(actorId, orgId);
  if (!permission.ok) throw new Error(permission.error);
  return actorId;
}

export async function GET(req: Request) {
  try {
    const orgId = cleanStr(new URL(req.url).searchParams.get("org_id"));
    if (!orgId) return NextResponse.json<ErrorJson>({ error: "Missing org_id" }, { status: 400 });
    await authorize(req, orgId);
    const { data, error } = await supabaseAdmin
      .from("schedule_settings")
      .select("show_birthdays")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, settings: { show_birthdays: data?.show_birthdays ?? true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load schedule settings";
    return NextResponse.json<ErrorJson>({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["org_id", "show_birthdays"].includes(key))) {
      return NextResponse.json<ErrorJson>({ error: "Invalid schedule settings request" }, { status: 400 });
    }
    const orgId = cleanStr(typeof body.org_id === "string" ? body.org_id : null);
    if (!orgId || typeof body.show_birthdays !== "boolean") {
      return NextResponse.json<ErrorJson>({ error: "Invalid schedule settings request" }, { status: 400 });
    }
    const actorId = await authorize(req, orgId);
    const { data, error } = await supabaseAdmin
      .from("schedule_settings")
      .upsert({ org_id: orgId, show_birthdays: body.show_birthdays, updated_by: actorId, updated_at: new Date().toISOString() })
      .select("show_birthdays")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, settings: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save schedule settings";
    return NextResponse.json<ErrorJson>({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}
