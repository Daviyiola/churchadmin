import { normalizePlanKey } from "@/lib/plans";
import { requireBillingActor } from "@/lib/server/billing/auth";
import { getStripePrice } from "@/lib/server/billing/catalog";
import { getStripe } from "@/lib/server/billing/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
const rank={free:0,basic:1,growth:2,pro:3,enterprise:4};
export async function POST(req:Request){try{const body=await req.json() as Record<string,unknown>;const org=String(body.organization_id??"");const actor=await requireBillingActor(req,org,true);const plan=normalizePlanKey(body.plan);const interval=String(body.interval??"monthly") as "monthly"|"annual";
 if(!["basic","growth","pro"].includes(plan)||!["monthly","annual"].includes(interval))throw new Error("Invalid plan selection.");
 const {data}=await supabaseAdmin.from("organization_subscriptions").select("stripe_subscription_id,plan_key,billing_interval,current_period_end").eq("organization_id",org).maybeSingle();if(!data?.stripe_subscription_id)throw new Error("Start a paid subscription before changing plans.");
 const subscription=await getStripe().subscriptions.retrieve(data.stripe_subscription_id);const item=subscription.items.data[0];if(!item)throw new Error("Subscription item missing.");const price=await getStripePrice(plan,interval);
 const immediate=rank[plan]>rank[normalizePlanKey(data.plan_key)]&&interval===data.billing_interval;
 if(!immediate)await supabaseAdmin.from("organization_subscriptions").update({scheduled_plan_key:plan,scheduled_interval:interval,updated_at:new Date().toISOString()}).eq("organization_id",org);
 try{
  const updated=await getStripe().subscriptions.update(subscription.id,{items:[{id:item.id,price}],proration_behavior:immediate?"always_invoice":"none",payment_behavior:immediate?"pending_if_incomplete":"allow_incomplete"});
  if(immediate){const {reconcileSubscription}=await import("@/lib/server/billing/reconcile");await reconcileSubscription(updated);}
 }catch(error){if(!immediate)await supabaseAdmin.from("organization_subscriptions").update({scheduled_plan_key:null,scheduled_interval:null,updated_at:new Date().toISOString()}).eq("organization_id",org);throw error;}
 await supabaseAdmin.from("billing_plan_events").insert({organization_id:org,actor_user_id:actor.userId,event_type:immediate?"upgrade_requested":"downgrade_scheduled",from_plan_key:data.plan_key,to_plan_key:plan,source:"owner",safe_metadata:{interval}});return Response.json({ok:true,effective:immediate?"after_payment":"period_end",period_end:data.current_period_end});
}catch(error){const m=error instanceof Error?error.message:"Unable to change plan.";return Response.json({error:m},{status:m==="UNAUTHORIZED"?401:m==="FORBIDDEN"?403:400});}}
