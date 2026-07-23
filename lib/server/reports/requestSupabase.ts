import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { financeWindowStart } from "@/lib/reports/financeWindow";

export type ReportOrgRole =
  | "owner"
  | "admin"
  | "finance"
  | "viewer"
  | "member";

type MembershipRow = { role: ReportOrgRole };

const REPORT_ORG_ROLES: readonly ReportOrgRole[] = [
  "owner",
  "admin",
  "finance",
  "viewer",
  "member",
];

function asReportOrgRole(value: unknown): ReportOrgRole {
  const role = String(value) as ReportOrgRole;
  return REPORT_ORG_ROLES.includes(role) ? role : "member";
}

export class ReportAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "ReportAccessError";
  }
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase server configuration is missing");
  }

  return { url, publishableKey };
}

/**
 * Creates a new client for exactly one incoming request. Its database queries
 * run with the caller's JWT and therefore remain subject to that user's RLS.
 * Never cache or export the returned client as a module-level singleton.
 */
export function createRequestSupabase(accessToken: string): SupabaseClient {
  const { url, publishableKey } = getSupabaseConfig();

  return createClient(url, publishableKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function getReportRequestContext(
  accessToken: string,
  organizationId: string,
): Promise<{ supabase: SupabaseClient; userId: string; role: ReportOrgRole }> {
  const supabase = createRequestSupabase(accessToken);

  const { data: userResult, error: userError } =
    await supabase.auth.getUser(accessToken);
  if (userError || !userResult.user) {
    throw new ReportAccessError("Unauthorized", 401);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userResult.user.id)
    .maybeSingle<MembershipRow>();

  if (membershipError) throw new Error(membershipError.message);
  if (!membership) throw new ReportAccessError("Forbidden", 403);

  return {
    supabase,
    userId: userResult.user.id,
    role: asReportOrgRole(membership.role),
  };
}

export function requireReportRoles<AllowedRole extends ReportOrgRole>(
  role: ReportOrgRole,
  allowedRoles: readonly AllowedRole[],
): asserts role is AllowedRole {
  if (!(allowedRoles as readonly ReportOrgRole[]).includes(role)) {
    throw new ReportAccessError("Forbidden", 403);
  }
}

export function reportErrorStatus(error: unknown): number {
  return error instanceof ReportAccessError ? error.status : 400;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function requireValidReportDateRange(
  startDate: string,
  endDate: string,
): void {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new Error("Report dates must use the YYYY-MM-DD format.");
  }
  if (startDate > endDate) {
    throw new Error("The report start date cannot be after its end date.");
  }
}

export function requireFinanceDateWindow(
  role: ReportOrgRole,
  startDate: string,
): void {
  if (role !== "finance") return;

  const cutoff = financeWindowStart();
  if (startDate < cutoff) {
    throw new ReportAccessError(
      `Finance reports cannot start before ${cutoff}.`,
      403,
    );
  }
}
