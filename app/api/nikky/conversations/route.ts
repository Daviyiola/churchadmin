import { requireNikkyContext, nikkyErrorResponse } from "@/lib/server/nikky/auth";
import { createConversation, listConversations } from "@/lib/server/nikky/repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const context = await requireNikkyContext(req);
    return Response.json({ conversations: await listConversations(context) });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const context = await requireNikkyContext(req);
    const raw = await req.text();
    if (raw.trim() && raw.trim() !== "{}") {
      return Response.json({ error: "New conversations do not accept parameters." }, { status: 400 });
    }
    return Response.json({ conversation: await createConversation(context) }, { status: 201 });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}
