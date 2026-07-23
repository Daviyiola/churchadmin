import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createRequestSupabase,
  getBearerToken,
} from "@/lib/server/reports/requestSupabase";
import {
  NikkyAccessError,
  type NikkyContext,
  type NikkyRole,
} from "@/lib/server/nikky/types";
import { getOrganizationEntitlements } from "@/lib/server/planEntitlements";

const NIKKY_ROLES: readonly NikkyRole[] = ["owner", "admin", "finance"];

type Membership = {
  organization_id: string;
  role: string;
  organizations: { name: string } | { name: string }[] | null;
};

function asOrganizationName(value: Membership["organizations"]): string {
  if (Array.isArray(value)) return value[0]?.name ?? "Organization";
  return value?.name ?? "Organization";
}

export async function requireNikkyUser(req: Request) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    throw new NikkyAccessError("Unauthorized", 401, "unauthorized");
  }
  const supabase = createRequestSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new NikkyAccessError("Unauthorized", 401, "unauthorized");
  }
  return { accessToken, supabase, user: data.user };
}

export async function listNikkyMemberships(req: Request) {
  const actor = await requireNikkyUser(req);
  const { data, error } = await actor.supabase
    .from("user_organizations")
    .select("organization_id,role,organizations(name)")
    .eq("user_id", actor.user.id)
    .in("role", [...NIKKY_ROLES]);
  if (error) throw new Error(error.message);
  return {
    ...actor,
    memberships: (data ?? []) as Membership[],
  };
}

export async function requireSelectedNikkyMembership(req: Request) {
  const actor = await listNikkyMemberships(req);
  const { data: initialSelected, error } = await supabaseAdmin
    .from("nikky_user_contexts")
    .select("organization_id")
    .eq("user_id", actor.user.id)
    .maybeSingle<{ organization_id: string }>();
  if (error) throw new Error(error.message);
  let selected = initialSelected;
  if (!selected && actor.memberships.length === 1) {
    selected = { organization_id: actor.memberships[0].organization_id };
    const saved = await supabaseAdmin.from("nikky_user_contexts").upsert({
      user_id: actor.user.id,
      organization_id: selected.organization_id,
      selected_at: new Date().toISOString(),
    });
    if (saved.error) throw new Error(saved.error.message);
  }
  const membership = actor.memberships.find((row) => row.organization_id === selected?.organization_id);
  if (!membership) throw new NikkyAccessError("Choose an organization first.", 409, "context_required");
  return { ...actor, membership, organizationId: membership.organization_id, role: membership.role as NikkyRole };
}

export async function requireNikkyContext(
  req: Request,
  options: { requireEnabled?: boolean } = {},
): Promise<NikkyContext> {
  const actor = await listNikkyMemberships(req);
  if (actor.memberships.length === 0) {
    throw new NikkyAccessError("Forbidden", 403, "forbidden");
  }

  const { data: initialSelected, error: selectedError } = await supabaseAdmin
    .from("nikky_user_contexts")
    .select("organization_id")
    .eq("user_id", actor.user.id)
    .maybeSingle<{ organization_id: string }>();
  if (selectedError) throw new Error(selectedError.message);
  let selected = initialSelected;

  if (!selected && actor.memberships.length === 1) {
    const organizationId = actor.memberships[0].organization_id;
    const { error } = await supabaseAdmin.from("nikky_user_contexts").upsert({
      user_id: actor.user.id,
      organization_id: organizationId,
      selected_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    selected = { organization_id: organizationId };
  }

  if (!selected) {
    throw new NikkyAccessError(
      "Choose an organization before opening Nikky.",
      409,
      "context_required",
    );
  }

  const membership = actor.memberships.find(
    (row) => row.organization_id === selected?.organization_id,
  );
  if (!membership || !NIKKY_ROLES.includes(membership.role as NikkyRole)) {
    throw new NikkyAccessError("Forbidden", 403, "forbidden");
  }

  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("organization_settings")
    .select(
      "timezone_name,timezone_confirmed,nikky_enabled",
    )
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      timezone_name: string | null;
      timezone_confirmed: boolean;
      nikky_enabled: boolean;
    }>();
  if (settingsError) throw new Error(settingsError.message);
  if (options.requireEnabled !== false && !settings?.nikky_enabled) {
    throw new NikkyAccessError(
      "Nikky is not enabled for this organization yet.",
      503,
      "not_enabled",
    );
  }
  if (!settings?.timezone_name || !settings.timezone_confirmed) {
    throw new NikkyAccessError(
      "An administrator must confirm the organization timezone before Nikky can be used.",
      503,
      "timezone_required",
    );
  }

  const entitlements = await getOrganizationEntitlements(membership.organization_id);
  const monthlyBudgetCents = entitlements.nikkyMonthlyBudgetCents;
  if (!monthlyBudgetCents) {
    throw new NikkyAccessError(
      "This organization needs a monthly Nikky allowance before Nikky can be enabled.",
      503,
      "budget_required",
    );
  }

  const { data: cutoff, error: cutoffError } = await actor.supabase.rpc(
    "finance_window_start",
  );
  if (cutoffError || typeof cutoff !== "string") {
    throw new Error(cutoffError?.message ?? "Unable to resolve finance window.");
  }

  return {
    accessToken: actor.accessToken,
    supabase: actor.supabase,
    userId: actor.user.id,
    userEmail: actor.user.email ?? null,
    organizationId: membership.organization_id,
    organizationName: asOrganizationName(membership.organizations),
    role: membership.role as NikkyRole,
    plan: entitlements.plan,
    timezone: settings.timezone_name,
    financeWindowStart: cutoff,
    monthlyBudgetCents,
  };
}

export function nikkyErrorResponse(error: unknown): Response {
  if (error instanceof NikkyAccessError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message, code: "internal_error" }, { status: 500 });
}
