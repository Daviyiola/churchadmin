import type { PlanKey } from "@/lib/plans";
import { SELF_SERVICE_PLANS, organizationName as validateName } from "@/lib/onboarding";
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
    if (Object.keys(body).some((key) => !["plan","interval","organization_name","intent_id"].includes(key))) throw new Error("INVALID_REQUEST");
    if (!SELF_SERVICE_PLANS.includes(body.plan as typeof SELF_SERVICE_PLANS[number])) throw new Error("Choose a valid plan.");
    const plan = body.plan as PlanKey;
    const interval = plan === "free" ? "none" : String(body.interval ?? "monthly");
    if (plan !== "free" && !["monthly","annual"].includes(interval)) throw new Error("Choose monthly or annual billing.");
    const organizationName = validateName(body.organization_name);
    const intentId = typeof body.intent_id === "string" ? body.intent_id : crypto.randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intentId)) throw new Error("Invalid setup request.");
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!authData.user?.email_confirmed_at) return Response.json({ error: "Verify your email before creating an organization." }, { status: 409 });
    const { data: prior, error: lookupError } = await supabaseAdmin.from("owner_onboarding_intents").select("id,user_id,plan_key,billing_interval,organization_name,provisioned_organization_id,stripe_checkout_session_id,expires_at").eq("id",intentId).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (prior && prior.user_id !== userId) throw new Error("This setup belongs to another account. Start again from plans.");
    if (prior?.provisioned_organization_id) return Response.json({ ok:true, organization_id:prior.provisioned_organization_id });
    if (prior && (prior.plan_key !== plan || prior.billing_interval !== interval || prior.organization_name !== organizationName)) throw new Error("Your setup details changed. Return to plans and try again.");
    if (prior?.stripe_checkout_session_id) {
      const checkout = await getStripe().checkout.sessions.retrieve(prior.stripe_checkout_session_id);
      if (checkout.status === "complete") return Response.json({ checkout_url:`/get-started?session_id=${encodeURIComponent(checkout.id)}` });
      if (checkout.status === "open" && checkout.url) return Response.json({ checkout_url:checkout.url });
      throw new Error("Checkout expired. Choose your plan again to start a new checkout.");
    }
    if (prior && new Date(prior.expires_at).getTime() <= Date.now()) throw new Error("Setup expired. Choose your plan again to start fresh.");
    // Validate Stripe configuration before creating a paid intent.
    const price = plan === "free" ? null : await getStripePrice(plan, interval as "monthly"|"annual");
    const { data: intent, error } = prior ? { data:prior, error:null } : await supabaseAdmin.from("owner_onboarding_intents").insert({
      id:intentId,
      user_id:userId,plan_key:plan,billing_interval:interval,organization_name:organizationName,
      requested_slug:slugify(organizationName),status:plan === "free" ? "processing" : "awaiting_checkout",
    }).select("id").single();
    if (error) throw new Error(error.message);
    if (plan === "free") {
      const { data: organizationId, error: provisionError } = await supabaseAdmin.rpc("provision_owner_organization", { p_intent_id:intent.id });
      if (provisionError) throw new Error(provisionError.message);
      return Response.json({ ok:true, organization_id:organizationId });
    }
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/,"");
    const session = await getStripe().checkout.sessions.create({
      mode:"subscription",customer_email:authData.user.email ?? undefined,billing_address_collection:"required",
      automatic_tax:{ enabled:stripeTaxEnabled() },line_items:[{ price:price!,quantity:1 }],
      client_reference_id:intent.id,metadata:{ onboarding_intent_id:intent.id },subscription_data:{ metadata:{ onboarding_intent_id:intent.id } },
      success_url:`${appUrl}/get-started?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${appUrl}/get-started?checkout=canceled&plan=${plan}&interval=${interval}`,
    },{ idempotencyKey:`onboarding-${intent.id}` });
    const { error: saveError } = await supabaseAdmin.from("owner_onboarding_intents").update({ stripe_checkout_session_id:session.id,updated_at:new Date().toISOString() }).eq("id",intent.id);
    if (saveError) throw new Error("Unable to save checkout. Please try again to recover the same checkout.");
    return Response.json({ ok:true, checkout_url:session.url });
  } catch (error) {
    const message=error instanceof Error?error.message:"Unable to start onboarding.";
    const status=message==="UNAUTHORIZED"?401:message.includes("FREE_ORGANIZATION_LIMIT")?409:400;
    return Response.json({ error:message.includes("FREE_ORGANIZATION_LIMIT")?"You already created a Free organization. Choose a paid plan for another organization.":message },{status});
  }
}
