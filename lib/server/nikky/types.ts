import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanKey } from "@/lib/plans";

export type NikkyRole = "owner" | "admin" | "finance";

export type NikkyContext = {
  accessToken: string;
  supabase: SupabaseClient;
  userId: string;
  userEmail: string | null;
  organizationId: string;
  organizationName: string;
  role: NikkyRole;
  plan: PlanKey;
  timezone: string;
  financeWindowStart: string;
  monthlyBudgetCents: number;
};

export type ToolOutcome =
  | "ok"
  | "no_records"
  | "forbidden"
  | "outside_finance_window"
  | "unavailable"
  | "ambiguous"
  | "calculation_failed";

export type NikkyToolResult = {
  outcome: ToolOutcome;
  evidence_id: string;
  applied: Record<string, unknown>;
  record_count: number;
  data?: unknown;
  message?: string;
};

export class NikkyAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 409 | 429 | 503,
    public readonly code:
      | "unauthorized"
      | "forbidden"
      | "context_required"
      | "not_enabled"
      | "timezone_required"
      | "budget_required"
      | "budget_exhausted"
      | "rate_limited",
  ) {
    super(message);
    this.name = "NikkyAccessError";
  }
}
