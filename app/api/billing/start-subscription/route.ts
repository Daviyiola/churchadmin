import { normalizePlanKey } from "@/lib/plans";
import { requireBillingActor } from "@/lib/server/billing/auth";
import { getStripePrice } from "@/lib/server/billing/catalog";
import { getStripe, stripeTaxEnabled } from "@/lib/server/billing/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req:Request){try{const body=await req.json() as Record<string,unknown>;const org=String(body.organization_id??"");const actor=await requireBillingActor(req,org,true);const plan=normalizePlanKey(body.plan);const interval=String(body.interval??"monthly") as "monthly"|"annual";
 if(!["basic","growth","pro"].includes(plan)||!["monthly","annual"].includes(interval))throw new Error("Invalid plan selection.");
 const [{data:subscription},{data:profile}]=await Promise.all([
  supabaseAdmin.from("organization_subscriptions").select("status,founder_ends_at,stripe_customer_id").eq("organization_id",org).maybeSingle(),
  supabaseAdmin.auth.admin.getUserById(actor.userId),
 ]);if(!profile.user?.email_confirmed_at)throw new Error("Verify your email before starting billing.");
 const founderEnd=subscription?.status==="founder_complimentary"&&subscription.founder_ends_at?new Date(subscription.founder_ends_at):null;
 if(founderEnd&&founderEnd.getTime()-Date.now()>30*86400000)throw new Error("Founder Pro renewal opens 30 days before the complimentary period ends.");
 const price=await getStripePrice(plan,interval);const appUrl=String(process.env.NEXT_PUBLIC_APP_URL??new URL(req.url).origin).replace(/\/$/,"");
 const session=await getStripe().checkout.sessions.create({mode:"subscription",customer:subscription?.stripe_customer_id??undefined,
  customer_email:subscription?.stripe_customer_id?undefined:profile.user.email??undefined,billing_address_collection:"required",automatic_tax:{enabled:stripeTaxEnabled()},
  payment_method_collection:"always",line_items:[{price,quantity:1}],metadata:{organization_id:org,renewal_plan:plan,renewal_interval:interval},
  subscription_data:{metadata:{organization_id:org},...(founderEnd?{trial_end:Math.floor(founderEnd.getTime()/1000)}:{})},
  success_url:`${appUrl}/app/settings/billing?checkout=success`,cancel_url:`${appUrl}/app/settings/billing?checkout=canceled`,
 },{idempotencyKey:`organization-subscription-${org}-${plan}-${interval}-${founderEnd?.toISOString()??"now"}`});
 return Response.json({url:session.url});
}catch(error){const m=error instanceof Error?error.message:"Unable to start subscription.";return Response.json({error:m},{status:m==="UNAUTHORIZED"?401:m==="FORBIDDEN"?403:400});}}
