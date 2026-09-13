import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import { organizationName, setupSettings } from "@/lib/onboarding";

async function authorize(req: Request, orgId: string) {
  const userId = await requireActorId(req);
  const { data, error } = await supabaseAdmin.from("user_organizations").select("role").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data || !["owner", "admin"].includes(data.role)) throw new Error("FORBIDDEN");
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to save organization settings. Please try again.";
  return Response.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
}
export async function GET(req: Request) {
  try {
    const orgId = new URL(req.url).searchParams.get("organization_id") ?? "";
    await authorize(req, orgId);
    const [org, settings] = await Promise.all([
      supabaseAdmin.from("organizations").select("name").eq("id", orgId).single(),
      supabaseAdmin.from("organization_settings").select("logo_path,use_default_logo,timezone_name,timezone_confirmed,mailing_address_line1,mailing_address_line2,mailing_city,mailing_state,mailing_postal_code,mailing_country").eq("organization_id", orgId).maybeSingle(),
    ]);
    if (org.error) throw org.error;
    if (settings.error) throw settings.error;
    return Response.json({ organization: org.data, settings: settings.data });
  } catch (error) { return failure(error); }
}
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const orgId = String(body.organization_id ?? "");
    await authorize(req, orgId);
    const name = organizationName(body.name);
    // A name-only update is also used by the full organization settings page.
    const settings = "timezone_name" in body ? setupSettings(body, orgId) : null;
    const org = await supabaseAdmin.from("organizations").update({ name }).eq("id", orgId).select("id").single();
    if (org.error) throw org.error;
    if (settings) {
      const result = await supabaseAdmin.from("organization_settings").upsert({ organization_id: orgId, ...settings }, { onConflict: "organization_id" });
      if (result.error) throw result.error;
    }
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
