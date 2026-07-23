import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { NikkyContext } from "@/lib/server/nikky/types";

export const NIKKY_GREETING =
  "Hi I'm Nikky, your church admin assistant. I can help answer questions and generate reports. what would you like to do";

export type ConversationRow = {
  id: string;
  organization_id: string;
  user_id: string;
  title: string;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "failed";
  evidence_ids: string[];
  model: string | null;
  created_at: string;
};

export async function listConversations(context: NikkyContext) {
  const { data, error } = await supabaseAdmin
    .from("nikky_conversations")
    .select("id,organization_id,user_id,title,context_summary,created_at,updated_at")
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationRow[];
}

export async function createConversation(context: NikkyContext) {
  const { data: conversation, error } = await supabaseAdmin
    .from("nikky_conversations")
    .insert({
      organization_id: context.organizationId,
      user_id: context.userId,
      title: "New conversation",
    })
    .select("id,organization_id,user_id,title,context_summary,created_at,updated_at")
    .single<ConversationRow>();
  if (error) throw new Error(error.message);

  const { error: messageError } = await supabaseAdmin.from("nikky_messages").insert({
    conversation_id: conversation.id,
    organization_id: context.organizationId,
    user_id: context.userId,
    role: "assistant",
    content: NIKKY_GREETING,
    status: "complete",
  });
  if (messageError) {
    await supabaseAdmin.from("nikky_conversations").delete().eq("id", conversation.id);
    throw new Error(messageError.message);
  }
  return conversation;
}

export async function requireConversation(
  context: NikkyContext,
  conversationId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("nikky_conversations")
    .select("id,organization_id,user_id,title,context_summary,created_at,updated_at")
    .eq("id", conversationId)
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId)
    .maybeSingle<ConversationRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function conversationMessages(
  context: NikkyContext,
  conversationId: string,
  limit = 200,
) {
  const conversation = await requireConversation(context, conversationId);
  if (!conversation) return null;
  const { data, error } = await supabaseAdmin
    .from("nikky_messages")
    .select("id,conversation_id,role,content,status,evidence_ids,model,created_at")
    .eq("conversation_id", conversationId)
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return { conversation, messages: (data ?? []) as MessageRow[] };
}

export async function renameConversation(
  context: NikkyContext,
  conversationId: string,
  title: string,
) {
  const { data, error } = await supabaseAdmin
    .from("nikky_conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId)
    .select("id,organization_id,user_id,title,context_summary,created_at,updated_at")
    .maybeSingle<ConversationRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteConversation(
  context: NikkyContext,
  conversationId: string,
) {
  const conversation = await requireConversation(context, conversationId);
  if (!conversation) return false;
  const { error } = await supabaseAdmin
    .from("nikky_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  return true;
}

export async function addMessage(
  context: NikkyContext,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  options: { evidenceIds?: string[]; model?: string; status?: "complete" | "failed" } = {},
) {
  const { data, error } = await supabaseAdmin
    .from("nikky_messages")
    .insert({
      conversation_id: conversationId,
      organization_id: context.organizationId,
      user_id: context.userId,
      role,
      content,
      status: options.status ?? "complete",
      evidence_ids: options.evidenceIds ?? [],
      model: options.model ?? null,
    })
    .select("id,conversation_id,role,content,status,evidence_ids,model,created_at")
    .single<MessageRow>();
  if (error) throw new Error(error.message);
  await supabaseAdmin
    .from("nikky_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  return data;
}
