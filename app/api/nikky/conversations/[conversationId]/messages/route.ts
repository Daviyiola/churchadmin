import { requireNikkyContext, nikkyErrorResponse } from "@/lib/server/nikky/auth";
import { enforceNikkyBudget, consumeChatRateLimit, recordNikkyUsage, acquireNikkyRequestSlot, releaseNikkyRequestSlot } from "@/lib/server/nikky/limits";
import { answerWithNikky } from "@/lib/server/nikky/openai";
import { addMessage, conversationMessages, renameConversation } from "@/lib/server/nikky/repository";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
type Params = { params: Promise<{ conversationId: string }> };

export async function POST(req: Request, { params }: Params) {
  let requestSlot: string | null = null;
  try {
    const context = await requireNikkyContext(req);
    const body = (await req.json()) as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "message") || typeof body.message !== "string") {
      return Response.json({ error: "A message is required." }, { status: 400 });
    }
    const message = body.message.trim();
    if (!message || message.length > 8_000) {
      return Response.json({ error: "Messages must contain 1 to 8,000 characters." }, { status: 400 });
    }
    const { conversationId } = await params;
    const existing = await conversationMessages(context, conversationId);
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const [budgetState] = await Promise.all([enforceNikkyBudget(context), consumeChatRateLimit(context)]);
    requestSlot = await acquireNikkyRequestSlot(context);
    const userMessage = await addMessage(context, conversationId, "user", message);
    const completion = await answerWithNikky(
      context,
      conversationId,
      [...existing.messages, userMessage],
      message,
    );
    const assistantMessage = await addMessage(context, conversationId, "assistant", completion.content, {
      evidenceIds: completion.evidenceIds,
      model: completion.model,
    });
    await recordNikkyUsage(context, completion.usage);
    if (existing.conversation.title === "New conversation") {
      await renameConversation(context, conversationId, message.replace(/\s+/g, " ").slice(0, 60));
    }
    const { data: confirmations } = await supabaseAdmin
      .from("nikky_report_confirmations")
      .select("id,report_type,format,canonical_parameters,access_classification,expires_at,status")
      .eq("conversation_id", conversationId)
      .eq("organization_id", context.organizationId)
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(3);
    const projectedPercentage = ((budgetState.usedMicros + completion.usage.estimatedCostMicros) / budgetState.budgetMicros) * 100;
    const usageWarning = projectedPercentage >= 90
      ? "Nikky has used at least 90% of this organization's monthly allowance."
      : projectedPercentage >= 70
        ? "Nikky has used at least 70% of this organization's monthly allowance."
        : null;
    return Response.json({
      user_message: userMessage,
      message: assistantMessage,
      confirmations: confirmations ?? [],
      usage_warning: usageWarning,
    });
  } catch (error) {
    return nikkyErrorResponse(error);
  } finally {
    if (requestSlot) await releaseNikkyRequestSlot(requestSlot);
  }
}
