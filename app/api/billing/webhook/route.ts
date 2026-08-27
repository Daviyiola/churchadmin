import type Stripe from "stripe";
import { getStripe } from "@/lib/server/billing/stripe";
import { reconcileSubscription } from "@/lib/server/billing/reconcile";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic="force-dynamic";
export async function POST(req:Request){
  const secret=process.env.STRIPE_WEBHOOK_SECRET?.trim(); const signature=req.headers.get("stripe-signature");
  if(!secret||!signature)return Response.json({error:"Billing webhook is not configured."},{status:503});
  let event:Stripe.Event; try{event=getStripe().webhooks.constructEvent(await req.text(),signature,secret);}catch{return Response.json({error:"Invalid signature."},{status:400});}
  const {data:prior,error:priorError}=await supabaseAdmin.from("stripe_webhook_events").select("status,attempts").eq("stripe_event_id",event.id).maybeSingle();
  if(priorError)return Response.json({error:"Unable to inspect event."},{status:500});
  if(prior?.status==="processed")return Response.json({received:true,duplicate:true});
  if(prior?.status==="processing")return Response.json({error:"Event is already processing."},{status:409});
  const claim=prior
    ? await supabaseAdmin.from("stripe_webhook_events").update({status:"processing",attempts:Number(prior.attempts??1)+1,last_error:null}).eq("stripe_event_id",event.id).eq("status","failed")
    : await supabaseAdmin.from("stripe_webhook_events").insert({stripe_event_id:event.id,event_type:event.type});
  if(claim.error)return Response.json({error:"Unable to claim event."},{status:500});
  try{
    if(event.type==="checkout.session.completed"){
      const session=event.data.object as Stripe.Checkout.Session; const intentId=session.metadata?.onboarding_intent_id;
      if(intentId&&session.subscription){
        const subscription=await getStripe().subscriptions.retrieve(String(session.subscription)); const item=subscription.items.data[0];
        const {data:organizationId,error}=await supabaseAdmin.rpc("provision_owner_organization",{p_intent_id:intentId,
          p_stripe_customer_id:String(session.customer),p_stripe_subscription_id:subscription.id,p_stripe_price_id:item?.price.id ?? null,
          p_period_start:item?new Date(item.current_period_start*1000).toISOString():null,p_period_end:item?new Date(item.current_period_end*1000).toISOString():null});
        if(error)throw new Error(error.message); await reconcileSubscription(subscription);
        await supabaseAdmin.from("billing_plan_events").insert({organization_id:organizationId,event_type:"checkout_completed",to_plan_key:null,source:"stripe",stripe_event_id:event.id});
      } else if(session.metadata?.organization_id&&session.subscription){
        const organizationId=session.metadata.organization_id;const subscription=await getStripe().subscriptions.retrieve(String(session.subscription));const item=subscription.items.data[0];
        const {data:current,error:currentError}=await supabaseAdmin.from("organization_subscriptions").select("status,founder_ends_at").eq("organization_id",organizationId).maybeSingle();if(currentError||!current)throw new Error("Organization subscription not found.");
        const founderActive=current.status==="founder_complimentary"&&current.founder_ends_at&&new Date(current.founder_ends_at).getTime()>Date.now();
        const {error:updateError}=await supabaseAdmin.from("organization_subscriptions").update({stripe_customer_id:String(session.customer),stripe_subscription_id:subscription.id,stripe_price_id:item?.price.id??null,
          scheduled_plan_key:founderActive?session.metadata.renewal_plan:null,scheduled_interval:founderActive?session.metadata.renewal_interval:null,updated_at:new Date().toISOString()}).eq("organization_id",organizationId);if(updateError)throw new Error(updateError.message);
        await reconcileSubscription(subscription);
      }
    } else if(event.type.startsWith("customer.subscription.")) await reconcileSubscription(event.data.object as Stripe.Subscription);
    else if(event.type==="invoice.payment_failed"||event.type==="invoice.paid"){
      const invoice=event.data.object as Stripe.Invoice; const details=invoice.parent?.subscription_details; const subscriptionId=details?.subscription;
      if(subscriptionId)await reconcileSubscription(await getStripe().subscriptions.retrieve(String(subscriptionId)));
    }
    await supabaseAdmin.from("stripe_webhook_events").update({status:"processed",processed_at:new Date().toISOString()}).eq("stripe_event_id",event.id);
    return Response.json({received:true});
  }catch(error){await supabaseAdmin.from("stripe_webhook_events").update({status:"failed",last_error:error instanceof Error?error.message:"Unknown error"}).eq("stripe_event_id",event.id);return Response.json({error:"Webhook processing failed."},{status:500});}
}
