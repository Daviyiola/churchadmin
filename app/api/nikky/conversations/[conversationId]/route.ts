import { requireNikkyContext, nikkyErrorResponse } from "@/lib/server/nikky/auth";
import { conversationMessages, deleteConversation, renameConversation } from "@/lib/server/nikky/repository";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
type Params = { params: Promise<{ conversationId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const context = await requireNikkyContext(req);
    const { conversationId } = await params;
    const result = await conversationMessages(context, conversationId);
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    const [{ data: confirmations }, { data: artifacts }] = await Promise.all([
      supabaseAdmin.from("nikky_report_confirmations").select("id,report_type,format,canonical_parameters,access_classification,expires_at,status,artifact_id").eq("conversation_id", conversationId).eq("organization_id", context.organizationId).eq("user_id", context.userId).order("created_at"),
      supabaseAdmin.from("nikky_report_artifacts").select("id,report_type,format,filename,status,record_count,expires_at,created_at").eq("conversation_id", conversationId).eq("organization_id", context.organizationId).eq("user_id", context.userId).order("created_at"),
    ]);
    return Response.json({ ...result, confirmations: confirmations ?? [], artifacts: artifacts ?? [] });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const context = await requireNikkyContext(req);
    const body = (await req.json()) as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "title") || typeof body.title !== "string") {
      return Response.json({ error: "Only title may be changed." }, { status: 400 });
    }
    const title = body.title.trim().slice(0, 120);
    if (!title) return Response.json({ error: "Title is required." }, { status: 400 });
    const { conversationId } = await params;
    const conversation = await renameConversation(context, conversationId, title);
    return conversation ? Response.json({ conversation }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const context = await requireNikkyContext(req);
    const { conversationId } = await params;
    const deleted = await deleteConversation(context, conversationId);
    return deleted ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}
