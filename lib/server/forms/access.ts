import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

export type ManagedFormContext = {
  actorId: string;
  role: "owner" | "admin" | "finance";
  form: {
    id: string;
    org_id: string;
    title: string;
    status: "draft" | "open" | "closed";
    form_kind: "generic" | "first_timer" | "member_update" | "attendance";
    revision: number;
    created_by: string;
    updated_by: string;
    created_at: string;
    updated_at: string;
  };
};

export async function requireManagedFormContext(
  req: Request,
  formId: string,
): Promise<ManagedFormContext> {
  const actorId = await requireActorId(req);
  const { data: form, error: formError } = await supabaseAdmin
    .from("forms")
    .select("id,org_id,title,status,form_kind,revision,created_by,updated_by,created_at,updated_at")
    .eq("id", formId)
    .maybeSingle();
  if (formError) throw new Error(formError.message);
  if (!form) throw new Error("Form not found");

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", form.org_id)
    .eq("user_id", actorId)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!["owner", "admin", "finance"].includes(String(membership?.role ?? ""))) {
    throw new Error("Forbidden");
  }

  return {
    actorId,
    role: String(membership?.role) as ManagedFormContext["role"],
    form: form as ManagedFormContext["form"],
  };
}

export function managedFormErrorStatus(message: string) {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Form not found") return 404;
  return 400;
}
