import { NextResponse } from "next/server";
import { requireOrgFinanceOrAbove, requireUser } from "@/lib/serverAuthz";
import { getAudienceOptions } from "@/lib/server/communications/audienceResolver";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
    const orgId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    if (!orgId) return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    const authz = await requireOrgFinanceOrAbove(orgId, user.userId);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    return NextResponse.json(await getAudienceOptions(orgId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load recipient options." }, { status: 400 });
  }
}
