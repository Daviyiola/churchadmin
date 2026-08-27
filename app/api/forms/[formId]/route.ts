import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import {
  optionalFormText,
  parseManagedFormFields,
  requireFormText,
} from "@/lib/server/forms/validation";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ formId: string }> },
) {
  try {
    const actorId = await requireActorId(req);
    const { formId } = await context.params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new Error("Invalid request.");
    const row = body as Record<string, unknown>;
    const action = String(row.action ?? "");

    if (action === "save") {
      const allowed = new Set(["action", "title", "description", "fields"]);
      if (Object.keys(row).some((key) => !allowed.has(key))) {
        throw new Error("Invalid request properties.");
      }
      const fields = parseManagedFormFields(row.fields);
      const { data, error } = await supabaseAdmin.rpc("save_managed_form", {
        p_form_id: formId,
        p_actor_id: actorId,
        p_title: requireFormText(row.title, "Form name", 120),
        p_description: optionalFormText(row.description, 2000),
        p_fields: fields,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, revision: Number(data) });
    }

    if (action === "status") {
      const allowed = new Set(["action", "status"]);
      if (Object.keys(row).some((key) => !allowed.has(key))) {
        throw new Error("Invalid request properties.");
      }
      const status = String(row.status ?? "");
      if (status !== "open" && status !== "closed") {
        throw new Error("Invalid form status.");
      }
      const { data, error } = await supabaseAdmin.rpc("set_managed_form_status", {
        p_form_id: formId,
        p_actor_id: actorId,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, revision: Number(data) });
    }

    if (action === "delete") {
      const allowed = new Set(["action"]);
      if (Object.keys(row).some((key) => !allowed.has(key))) {
        throw new Error("Invalid request properties.");
      }
      const { error } = await supabaseAdmin.rpc("delete_managed_form", {
        p_form_id: formId,
        p_actor_id: actorId,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    throw new Error("Invalid form action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update form.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
