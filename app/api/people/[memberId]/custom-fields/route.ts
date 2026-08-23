import { NextResponse } from "next/server";
import { requireActorId } from "@/lib/server/authUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = { params: Promise<{ memberId: string }> };

async function contextFor(req: Request, memberId: string) {
  const actorId = await requireActorId(req);
  const { data: member, error } = await supabaseAdmin.from("members").select("id,org_id,membership_stage,status").eq("id", memberId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!member || member.status === "merged") throw new Error("Person not found");
  const { data: membership } = await supabaseAdmin.from("user_organizations").select("role").eq("organization_id", member.org_id).eq("user_id", actorId).maybeSingle();
  const role = String(membership?.role ?? "");
  if (!["owner", "admin", "finance"].includes(role)) throw new Error("Forbidden");
  return { actorId, role, member };
}

function status(message: string) {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Person not found") return 404;
  return 400;
}

export async function GET(req: Request, route: RouteContext) {
  try {
    const { memberId } = await route.params;
    const { member } = await contextFor(req, memberId);
    const [definitions, values, firstTimerForm, personRecord] = await Promise.all([
      supabaseAdmin.from("person_custom_fields").select("id,name,field_type,options,status").eq("org_id", member.org_id).order("name"),
      supabaseAdmin.from("person_custom_field_values").select("custom_field_id,value,updated_at").eq("org_id", member.org_id).eq("member_id", memberId),
      member.membership_stage === "visitor" ? supabaseAdmin.from("forms").select("id").eq("org_id", member.org_id).eq("form_kind", "first_timer").maybeSingle() : Promise.resolve({ data: null, error: null }),
      supabaseAdmin.from("members").select("email,phone,address,marital_status,children_count,visitor_details(first_visit_at,how_heard,prayer_request_tags)").eq("id", memberId).maybeSingle(),
    ]);
    if (definitions.error) throw new Error(definitions.error.message);
    if (values.error) throw new Error(values.error.message);
    if (firstTimerForm.error) throw new Error(firstTimerForm.error.message);
    if (personRecord.error) throw new Error(personRecord.error.message);
    let currentCustomIds: string[] = [];
    let currentStandardKeys: string[] = [];
    let retiredStandardFields: Array<{ key: string; label: string; value: unknown }> = [];
    if (firstTimerForm.data?.id) {
      const [fields, mappings] = await Promise.all([
        supabaseAdmin.from("form_fields").select("field_key").eq("form_id", firstTimerForm.data.id),
        supabaseAdmin.from("form_person_field_mappings").select("field_key,target_type,standard_key,custom_field_id").eq("form_id", firstTimerForm.data.id),
      ]);
      if (fields.error) throw new Error(fields.error.message);
      if (mappings.error) throw new Error(mappings.error.message);
      const currentKeys = new Set((fields.data ?? []).map((item) => String(item.field_key)));
      currentCustomIds = (mappings.data ?? []).filter((item) => currentKeys.has(String(item.field_key)) && item.target_type === "custom").map((item) => String(item.custom_field_id));
      currentStandardKeys = (mappings.data ?? []).filter((item) => currentKeys.has(String(item.field_key)) && item.target_type === "standard").map((item) => String(item.standard_key));
      const visitorDetails = Array.isArray(personRecord.data?.visitor_details) ? personRecord.data.visitor_details[0] : personRecord.data?.visitor_details;
      const standardValues: Record<string, unknown> = {
        email: personRecord.data?.email, phone: personRecord.data?.phone,
        address: personRecord.data?.address, marital_status: personRecord.data?.marital_status,
        children_count: personRecord.data?.children_count,
        first_visit_at: visitorDetails?.first_visit_at, how_heard: visitorDetails?.how_heard,
        prayer_requests: visitorDetails?.prayer_request_tags,
      };
      const currentStandard = new Set(currentStandardKeys);
      const retired = new Set((mappings.data ?? []).filter((item) => item.target_type === "standard" && !currentKeys.has(String(item.field_key))).map((item) => String(item.standard_key)));
      retiredStandardFields = [...retired]
        .filter((key) => !currentStandard.has(key) && standardValues[key] !== null && standardValues[key] !== undefined && standardValues[key] !== "")
        .map((key) => ({ key, label: key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), value: standardValues[key] }));
    }
    return NextResponse.json({ definitions: definitions.data ?? [], values: values.data ?? [], current_custom_ids: currentCustomIds, current_standard_keys: currentStandardKeys, retired_standard_fields: retiredStandardFields });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load custom fields.";
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}

export async function PATCH(req: Request, route: RouteContext) {
  try {
    const { memberId } = await route.params;
    const { actorId } = await contextFor(req, memberId);
    const body = await req.json().catch(() => null) as { values?: Array<{ field_id?: string; value?: unknown }> } | null;
    if (!body || !Array.isArray(body.values) || body.values.length > 50) throw new Error("Invalid request");
    const values = body.values.map((item) => ({ field_id: String(item.field_id ?? ""), value: item.value ?? null }));
    const { error } = await supabaseAdmin.rpc("update_person_custom_fields", { p_member_id: memberId, p_actor_id: actorId, p_values: values });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save custom fields.";
    return NextResponse.json({ error: message }, { status: status(message) });
  }
}
