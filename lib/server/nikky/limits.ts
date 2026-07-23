import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomUUID } from "node:crypto";
import { NikkyAccessError, type NikkyContext } from "@/lib/server/nikky/types";

const CHAT_USER_PER_MINUTE = 10;
const CHAT_ORG_PER_MINUTE = 60;

function monthStartIso(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}-01`;
}

export async function enforceNikkyBudget(context: NikkyContext) {
  const { data, error } = await supabaseAdmin
    .from("nikky_usage_monthly")
    .select("estimated_cost_micros")
    .eq("organization_id", context.organizationId)
    .eq("usage_month", monthStartIso(context.timezone));
  if (error) throw new Error(error.message);
  const usedMicros = (data ?? []).reduce(
    (sum, row) => sum + Number(row.estimated_cost_micros ?? 0),
    0,
  );
  const budgetMicros = context.monthlyBudgetCents * 10_000;
  if (usedMicros >= budgetMicros) {
    throw new NikkyAccessError(
      "Nikky has reached this organization's monthly allowance and is paused until it resets.",
      429,
      "budget_exhausted",
    );
  }
  return { usedMicros, budgetMicros, percentage: (usedMicros / budgetMicros) * 100 };
}

export async function consumeChatRateLimit(context: NikkyContext) {
  const { error } = await supabaseAdmin.rpc("consume_nikky_rate_event", {
    p_organization_id: context.organizationId, p_user_id: context.userId,
    p_event_type: "chat", p_window_seconds: 60,
    p_user_limit: CHAT_USER_PER_MINUTE, p_org_limit: CHAT_ORG_PER_MINUTE,
  });
  if (error) {
    throw new NikkyAccessError(
      "Nikky is receiving too many requests. Please wait a moment and try again.",
      429,
      "rate_limited",
    );
  }
}

export async function consumeReportRateLimit(context: NikkyContext) {
  const { error } = await supabaseAdmin.rpc("consume_nikky_rate_event", { p_organization_id: context.organizationId, p_user_id: context.userId, p_event_type: "report", p_window_seconds: 600, p_user_limit: 5, p_org_limit: 40 });
  if (error) throw new NikkyAccessError("Report generation limit reached. Please wait before generating another report.", 429, "rate_limited");
}

export async function acquireNikkyRequestSlot(context: NikkyContext) {
  const requestId = randomUUID();
  const { error } = await supabaseAdmin.rpc("acquire_nikky_request_slot", { p_request_id: requestId, p_organization_id: context.organizationId, p_user_id: context.userId });
  if (error) throw new NikkyAccessError("Nikky is already handling the maximum number of requests. Please wait a moment.", 429, "rate_limited");
  return requestId;
}

export async function releaseNikkyRequestSlot(requestId: string) {
  await supabaseAdmin.rpc("release_nikky_request_slot", { p_request_id: requestId });
}

export async function recordNikkyUsage(
  context: NikkyContext,
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    toolCalls: number;
    estimatedCostMicros: number;
  },
) {
  const usageMonth = monthStartIso(context.timezone);
  const { error } = await supabaseAdmin.rpc("increment_nikky_usage", { p_organization_id: context.organizationId, p_user_id: context.userId, p_usage_month: usageMonth, p_input: usage.inputTokens, p_cached: usage.cachedInputTokens, p_output: usage.outputTokens, p_tool_calls: usage.toolCalls, p_cost: usage.estimatedCostMicros });
  if (error) throw new Error(error.message);
}
