// lib/schedule/public.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { OrgBranding } from "./types";

const LOGO_BUCKET = process.env.SUPABASE_LOGO_BUCKET || "org-logos";

async function makeLogoUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;

  // 7 days
  const { data, error } = await supabaseAdmin.storage
    .from(LOGO_BUCKET)
    .createSignedUrl(logoPath, 60 * 60 * 24 * 7);

  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function resolveOrgByToken(token: string): Promise<
  | { ok: true; org_id: string; is_active: boolean }
  | { ok: false; error: string; status: number }
> {
  const { data, error } = await supabaseAdmin
    .from("schedule_public_tokens")
    .select("org_id,is_active")
    .eq("token", token)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, status: 400 };
  if (!data) return { ok: false, error: "Invalid link.", status: 404 };
  if (!data.is_active) return { ok: false, error: "This schedule link is inactive.", status: 410 };

  return { ok: true, org_id: String(data.org_id), is_active: Boolean(data.is_active) };
}

export async function loadOrgBranding(orgId: string): Promise<
  | { ok: true; org: OrgBranding }
  | { ok: false; error: string; status: number }
> {
  const [{ data: org, error: orgErr }, { data: settings, error: setErr }] =
    await Promise.all([
      supabaseAdmin.from("organizations").select("id,name").eq("id", orgId).maybeSingle(),
      supabaseAdmin
        .from("organization_settings")
        .select("logo_path,use_default_logo")
        .eq("organization_id", orgId)
        .maybeSingle(),
    ]);

  if (orgErr) return { ok: false, error: orgErr.message, status: 400 };
  if (!org) return { ok: false, error: "Invalid organization.", status: 404 };

  if (setErr && setErr.code !== "PGRST116") {
    return { ok: false, error: setErr.message, status: 400 };
  }

  const logo_path = settings?.logo_path ?? null;
  const use_default_logo = settings?.use_default_logo ?? true;

  const logo_url =
    !use_default_logo && logo_path ? await makeLogoUrl(logo_path) : null;

  return {
    ok: true,
    org: {
      id: String(org.id),
      name: String(org.name),
      settings: {
        logo_path,
        use_default_logo,
        logo_url,
      },
    },
  };
}
