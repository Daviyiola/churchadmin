import { normalizePlanKey } from "@/lib/plans";
import { requireActorId } from "@/lib/server/authUser";
import { getStripePrice } from "@/lib/server/billing/catalog";
import { getStripe, stripeTaxEnabled } from "@/lib/server/billing/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,52) || "church";
}

export async function POST(req: Request) {
  try {
    const userId = await requireActorId(req);
    const body = await req.json() as Record<string,unknown>;
    if (Object.keys(body).some((key) => !["plan","interval","organization_name"].includes(key))) throw new Error("INVALID_REQUEST");
    const plan = normalizePlanKey(body.plan);
    if (!["free","basic","growth","pro"].includes(plan)) throw new Error("INVALID_PLAN");
    const interval = plan === "free" ? "none" : String(body.interval ?? "monthly");
    if (!["none","monthly","annual"].includes(interval)) throw new Error("INVALID_INTERVAL");
    const organizationName = String(body.organization_name ?? "").trim();
    if (organizationName.length < 2 || organizationName.length > 120) throw new Error("INVALID_ORGANIZATION_NAME");
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!authData.user?.email_confirmed_at) return Response.json({ error: "Verify your email before creating an organization." }, { status: 409 });
    const { data: intent, error } = await supabaseAdmin.from("owner_onboarding_intents").insert({
      user_id:userId,plan_key:plan,billing_interval:interval,organization_name:organizationName,
      requested_slug:slugify(organizationName),status:plan === "free" ? "processing" : "awaiting_checkout",
    }).select("id").single();
    if (error) throw new Error(error.message);
    if (plan === "free") {
      const { data: organizationId, error: provisionError } = await supabaseAdmin.rpc("provision_owner_organization", { p_intent_id:intent.id });
      if (provisionError) throw new Error(provisionError.message);
      return Response.json({ ok:true, organization_id:organizationId });
    }
    const price = await getStripePrice(plan, interval as "monthly"|"annual");
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/,"");
    const session = await getStripe().checkout.sessions.create({
      mode:"subscription",customer_email:authData.user.email ?? undefined,billing_address_collection:"required",
      automatic_tax:{ enabled:stripeTaxEnabled() },line_items:[{ price,quantity:1 }],
      client_reference_id:intent.id,metadata:{ onboarding_intent_id:intent.id },subscription_data:{ metadata:{ onboarding_intent_id:intent.id } },
      success_url:`${appUrl}/get-started?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${appUrl}/get-started?checkout=canceled`,
    },{ idempotencyKey:`onboarding-${intent.id}` });
    await supabaseAdmin.from("owner_onboarding_intents").update({ stripe_checkout_session_id:session.id,updated_at:new Date().toISOString() }).eq("id",intent.id);
    return Response.json({ ok:true, checkout_url:session.url });
  } catch (error) {
    const message=error instanceof Error?error.message:"Unable to start onboarding.";
    const status=message==="UNAUTHORIZED"?401:message.includes("FREE_ORGANIZATION_LIMIT")?409:400;
    return Response.json({ error:message.includes("FREE_ORGANIZATION_LIMIT")?"You already created a Free organization. Choose a paid plan for another organization.":message },{status});
  }
}
