import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { NikkyContext } from "@/lib/server/nikky/types";

export type AuditInput = {
  conversationId?: string;
  toolName?: string;
  reportType?: string;
  confirmationId?: string;
  artifactId?: string;
  requested?: Record<string, unknown>;
  applied?: Record<string, unknown>;
  authorizationOutcome: "allowed" | "denied";
  outcome: string;
  errorCode?: string;
  classifications?: string[];
  recordCount?: number;
  durationMs?: number;
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  estimatedCostMicros?: number;
  memberId?: string;
};

function memberHmac(memberId: string | undefined) {
  if (!memberId) return null;
  const secret =
    process.env.NIKKY_AUDIT_HMAC_SECRET ??
    process.env.NIKKY_CONTEXT_SIGNING_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(memberId).digest("hex");
}

export async function appendNikkyAudit(context: NikkyContext, input: AuditInput) {
  const { error } = await supabaseAdmin.from("nikky_audit_logs").insert({
    organization_id: context.organizationId,
    user_id: context.userId,
    role_snapshot: context.role,
    conversation_id: input.conversationId ?? null,
    tool_name: input.toolName ?? null,
    report_type: input.reportType ?? null,
    confirmation_id: input.confirmationId ?? null,
    artifact_id: input.artifactId ?? null,
    requested_parameters: input.requested ?? {},
    applied_parameters: input.applied ?? {},
    authorization_outcome: input.authorizationOutcome,
    outcome: input.outcome,
    error_code: input.errorCode ?? null,
    access_classifications: input.classifications ?? [],
    record_count: input.recordCount ?? null,
    duration_ms: input.durationMs ?? null,
    model: input.model ?? null,
    input_tokens: input.inputTokens ?? null,
    cached_input_tokens: input.cachedInputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    estimated_cost_micros: input.estimatedCostMicros ?? null,
    member_reference_hmac: memberHmac(input.memberId),
  });
  if (error) throw new Error(error.message);
}
