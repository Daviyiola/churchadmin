import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nikkyErrorResponse, requireNikkyUser } from "@/lib/server/nikky/auth";
import { verifyContextSelectionHandle } from "@/lib/server/nikky/signing";

export async function POST(req: Request) {
  try {
    const actor = await requireNikkyUser(req);
    const body = (await req.json()) as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => key !== "selection_handle") ||
      typeof body.selection_handle !== "string"
    ) {
      return Response.json({ error: "A valid selection handle is required." }, { status: 400 });
    }

    const selection = verifyContextSelectionHandle(body.selection_handle, actor.user.id);
    if (!selection) {
      return Response.json({ error: "That organization selection has expired." }, { status: 400 });
    }

    const { data: membership, error: membershipError } = await actor.supabase
      .from("user_organizations")
      .select("role")
      .eq("user_id", actor.user.id)
      .eq("organization_id", selection.organization_id)
      .in("role", ["owner", "admin", "finance"])
      .maybeSingle<{ role: string }>();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) return Response.json({ error: "Forbidden" }, { status: 403 });

    const { error } = await supabaseAdmin.from("nikky_user_contexts").upsert({
      user_id: actor.user.id,
      organization_id: selection.organization_id,
      selected_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, role: membership.role });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}
