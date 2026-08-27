import { requireBillingActor } from "@/lib/server/billing/auth";
import { getStripe } from "@/lib/server/billing/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
export async function POST(req:Request){try{const body=await req.json() as {organization_id?:string};const org=String(body.organization_id??"");const actor=await requireBillingActor(req,org,true);
 const {data}=await supabaseAdmin.from("organization_subscriptions").select("stripe_subscription_id,plan_key").eq("organization_id",org).maybeSingle();if(!data?.stripe_subscription_id)throw new Error("There is no renewing subscription to cancel.");
 await getStripe().subscriptions.update(data.stripe_subscription_id,{cancel_at_period_end:true});await supabaseAdmin.from("organization_subscriptions").update({cancel_at_period_end:true,updated_at:new Date().toISOString()}).eq("organization_id",org);
 await supabaseAdmin.from("billing_plan_events").insert({organization_id:org,actor_user_id:actor.userId,event_type:"cancellation_scheduled",from_plan_key:data.plan_key,source:"owner"});return Response.json({ok:true});
}catch(error){const m=error instanceof Error?error.message:"Unable to cancel.";return Response.json({error:m},{status:m==="UNAUTHORIZED"?401:m==="FORBIDDEN"?403:400});}}
