import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  managedFormErrorStatus,
  requireManagedFormContext,
} from "@/lib/server/forms/access";
import { validatePersonFieldMapping } from "@/lib/forms/personFieldValidation";

type RouteContext = {
  params: Promise<{ formId: string; submissionId: string }>;
};

async function requireSubmission(formId: string, submissionId: string, orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("form_submissions")
    .select("id,form_id,org_id,answers,form_snapshot,result_member_id,person_action,processed_at")
    .eq("id", submissionId)
    .eq("form_id", formId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Submission not found");
  return data;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { formId, submissionId } = await context.params;
    const { form, role } = await requireManagedFormContext(req, formId);
    const submission = await requireSubmission(formId, submissionId, form.org_id);
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

    const [mappingsResult, customFieldsResult] = await Promise.all([
      supabaseAdmin
        .from("form_person_field_mappings")
        .select("field_key,target_type,standard_key,custom_field_id")
        .eq("form_id", formId),
      supabaseAdmin
        .from("person_custom_fields")
        .select("id,name,field_type,options,status")
        .eq("org_id", form.org_id)
        .eq("status", "active")
        .order("name"),
    ]);
    if (mappingsResult.error) throw new Error(mappingsResult.error.message);
    if (customFieldsResult.error) throw new Error(customFieldsResult.error.message);

    let candidates: unknown[] = [];
    if (q.length >= 2) {
      const tokens = q.replace(/[^\p{L}\p{N}@.+\-]+/gu, " ").split(/\s+/).filter(Boolean);
      const probe = tokens.at(-1) ?? "";
      const { data, error } = await supabaseAdmin
        .from("members")
        .select("id,first_name,last_name,gender,age_group,email,phone,address,marital_status,children_count,joined_at,dob,notes,baptized,baptism_date,born_again,born_again_date,department_category_id,membership_stage,status,visitor_details(first_visit_at,how_heard,prayer_request_tags),person_custom_field_values(custom_field_id,value)")
        .eq("org_id", form.org_id)
        .neq("status", "merged")
        .or(`first_name.ilike.%${probe}%,last_name.ilike.%${probe}%,email.ilike.%${probe}%,phone.ilike.%${probe}%`)
        .order("first_name")
        .order("last_name")
        .limit(50);
      if (error) throw new Error(error.message);
      candidates = (data ?? []).filter((item) => {
        const searchable = `${item.first_name ?? ""} ${item.last_name ?? ""} ${item.email ?? ""} ${item.phone ?? ""}`.toLowerCase();
        return tokens.every((token) => searchable.includes(token.toLowerCase()));
      }).slice(0, 12);
    }

    return NextResponse.json({
      role,
      submission,
      mappings: mappingsResult.data ?? [],
      custom_fields: customFieldsResult.data ?? [],
      candidates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load people options.";
    return NextResponse.json({ error: message }, { status: managedFormErrorStatus(message) });
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { formId, submissionId } = await context.params;
    const { actorId, form } = await requireManagedFormContext(req, formId);
    await requireSubmission(formId, submissionId, form.org_id);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const allowed = ["action", "target_member_id", "standard_values", "standard_mappings", "custom_values"];
    if (!body || Object.keys(body).some((key) => !allowed.includes(key))) throw new Error("Invalid request");

    const action = String(body.action ?? "");
    if (!["create_member", "create_visitor", "update_person"].includes(action)) throw new Error("Invalid request");
    if (typeof body.standard_values !== "object" || Array.isArray(body.standard_values) || body.standard_values === null) throw new Error("Invalid request");
    if (typeof body.standard_mappings !== "object" || Array.isArray(body.standard_mappings) || body.standard_mappings === null) throw new Error("Invalid request");
    if (!Array.isArray(body.custom_values)) throw new Error("Invalid request");
    if (action === "update_person"
      && Object.keys(body.standard_values as Record<string, unknown>).length === 0
      && body.custom_values.length === 0) {
      throw new Error("Select at least one submitted value to apply.");
    }
    for (const [key, value] of Object.entries(body.standard_values as Record<string, unknown>)) {
      const validation = validatePersonFieldMapping(`standard:${key}`, value, []);
      if (!validation.valid) throw new Error(validation.message ?? "PERSON_PROCESSING_INVALID");
    }

    const { data, error } = await supabaseAdmin.rpc("process_form_submission_to_person", {
      p_submission_id: submissionId,
      p_actor_id: actorId,
      p_action: action,
      p_target_member_id: body.target_member_id ? String(body.target_member_id) : null,
      p_standard_values: body.standard_values,
      p_standard_mappings: body.standard_mappings,
      p_custom_values: body.custom_values,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save this submission to People.";
    const known = message.includes("SUBMISSION_ALREADY_PROCESSED") ? 409 : managedFormErrorStatus(message);
    return NextResponse.json({ error: message }, { status: known });
  }
}
