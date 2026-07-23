import { createContextSelectionHandle } from "@/lib/server/nikky/signing";
import { listNikkyMemberships, nikkyErrorResponse } from "@/lib/server/nikky/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await listNikkyMemberships(req);
    return Response.json({
      options: actor.memberships.map((membership) => ({
        organization_id: membership.organization_id,
        organization_name: Array.isArray(membership.organizations)
          ? membership.organizations[0]?.name ?? "Organization"
          : membership.organizations?.name ?? "Organization",
        role: membership.role,
        selection_handle: createContextSelectionHandle(
          actor.user.id,
          membership.organization_id,
        ),
      })),
    });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}
