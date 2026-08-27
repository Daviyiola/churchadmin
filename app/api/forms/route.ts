import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import { optionalFormText, requireFormText } from "@/lib/server/forms/validation";
import { getOrganizationEntitlements } from "@/lib/server/planEntitlements";

function formSlug(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "form";
  return `${base}-${crypto.randomBytes(6).toString("hex")}`;
}

export async function GET(req: Request) {
  try {
    const actorId = await requireActorId(req);
    const organizationId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    if (!organizationId) throw new Error("Organization is required.");

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", actorId)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!["owner", "admin", "finance"].includes(String(membership?.role ?? ""))) throw new Error("Forbidden");

    const { data: forms, error: formsError } = await supabaseAdmin
      .from("forms")
      .select("id,title,description,status,form_kind,is_system,slug,revision,updated_at")
      .eq("org_id", organizationId)
      .order("updated_at", { ascending: false });
    if (formsError) throw new Error(formsError.message);

    const firstTimerForm = (forms ?? []).find((form) => form.form_kind === "first_timer");
    let firstTimerResponses = 0;
    if (firstTimerForm) {
      const [activeVisitors, joinedVisitors] = await Promise.all([
        supabaseAdmin.from("members").select("id", { count: "exact", head: true })
          .eq("org_id", organizationId).eq("membership_stage", "visitor").eq("status", "active"),
        supabaseAdmin.from("members").select("id,visitor_details!inner(member_id)", { count: "exact", head: true })
          .eq("org_id", organizationId).eq("membership_stage", "visitor").eq("status", "active")
          .eq("visitor_details.follow_up_status", "joined"),
      ]);
      if (activeVisitors.error) throw new Error(activeVisitors.error.message);
      if (joinedVisitors.error) throw new Error(joinedVisitors.error.message);
      firstTimerResponses = Math.max(0, (activeVisitors.count ?? 0) - (joinedVisitors.count ?? 0));
    }

    const responseCounts = await Promise.all((forms ?? []).map(async (form) => {
      if (form.form_kind === "first_timer") return [form.id, firstTimerResponses] as const;
      const { count, error } = await supabaseAdmin.from("form_submissions")
        .select("id", { count: "exact", head: true }).eq("form_id", form.id).eq("org_id", organizationId);
      if (error) throw new Error(error.message);
      return [form.id, count ?? 0] as const;
    }));
    const counts = new Map(responseCounts);

    const entitlements = await getOrganizationEntitlements(organizationId);
    return NextResponse.json({
      forms: (forms ?? []).map((form) => ({
        ...form,
        response_count: counts.get(form.id) ?? 0,
      })),
      form_usage: {
        used: (forms ?? []).filter((form) => !form.is_system).length,
        limit: entitlements.formCountLimit,
        plan: entitlements.plan,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load forms.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const actorId = await requireActorId(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new Error("Invalid request.");

    const row = body as Record<string, unknown>;
    const allowed = new Set(["organization_id", "title", "description"]);
    if (Object.keys(row).some((key) => !allowed.has(key))) {
      throw new Error("Invalid request properties.");
    }

    const organizationId = String(row.organization_id ?? "").trim();
    if (!organizationId) throw new Error("Organization is required.");
    const title = requireFormText(row.title, "Form name", 120);
    const description = optionalFormText(row.description, 2000);

    const { data, error } = await supabaseAdmin.rpc("create_managed_form", {
      p_org_id: organizationId,
      p_actor_id: actorId,
      p_title: title,
      p_description: description,
      p_slug: formSlug(title),
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, form_id: String(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create form.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "Forbidden" ? 403 :
      message.includes("FORM_PLAN_LIMIT_REACHED") ? 409 : 400;
    return NextResponse.json({
      error: message.includes("FORM_PLAN_LIMIT_REACHED")
        ? "This organization has reached its plan's form limit."
        : message,
    }, { status });
  }
}
