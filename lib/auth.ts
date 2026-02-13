import { supabase } from "@/lib/supabaseClient";

export async function signInWithOrg(email: string, password: string, orgId: string) {
  // 1) Sign in
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false as const, message: error.message };

  const user = data.user;
  if (!user) return { ok: false as const, message: "No user returned from auth." };

  // 2) Check membership in selected org (Policy: read own org links)
  const { data: link, error: linkErr } = await supabase
    .from("user_organizations")
    .select("id, role, organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (linkErr) {
    // Clean up: sign out if we can't verify access
    await supabase.auth.signOut();
    return { ok: false as const, message: linkErr.message };
  }

  if (!link) {
    await supabase.auth.signOut();
    return { ok: false as const, message: "You don’t have access to this organization." };
  }

  // 3) Persist tenant context locally (v1)
  localStorage.setItem("active_org_id", orgId);
  localStorage.setItem("active_org_role", link.role);

  return { ok: true as const };
}

export async function signOut() {
  localStorage.removeItem("active_org_id");
  localStorage.removeItem("active_org_role");
  await supabase.auth.signOut();
}

export function getActiveOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("active_org_id");
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function getActiveOrgRole(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("active_org_role");
}

export async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function applyOrgContext(orgId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;

  if (!user) {
    return { ok: false as const, message: "Not signed in." };
  }

  const { data: link, error: linkErr } = await supabase
    .from("user_organizations")
    .select("id, role, organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (linkErr) return { ok: false as const, message: linkErr.message };

  if (!link) {
    await supabase.auth.signOut();
    localStorage.removeItem("active_org_id");
    localStorage.removeItem("active_org_role");
    return { ok: false as const, message: "You don’t have access to this organization." };
  }

  localStorage.setItem("active_org_id", orgId);
  localStorage.setItem("active_org_role", link.role);

  return { ok: true as const };
}

