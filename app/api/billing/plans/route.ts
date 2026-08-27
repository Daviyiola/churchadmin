import { getPublicPlans } from "@/lib/server/billing/catalog";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ plans: await getPublicPlans() }); }
  catch { return Response.json({ error: "Unable to load plans." }, { status: 500 }); }
}
