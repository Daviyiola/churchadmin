import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const statusMap: Record<string,string>={active:"active",trialing:"active",past_due:"past_due",canceled:"canceled",unpaid:"unpaid",incomplete:"incomplete",incomplete_expired:"canceled",paused:"past_due"};
export async function reconcileSubscription(subscription: Stripe.Subscription) {
  const item=subscription.items.data[0]; const priceId=item?.price.id ?? null;
  const {data:catalog}=priceId?await supabaseAdmin.from("billing_plan_catalog").select("plan_key").or(`stripe_monthly_price_id.eq.${priceId},stripe_annual_price_id.eq.${priceId}`).maybeSingle():{data:null};
  const mapped=statusMap[subscription.status] ?? "incomplete";
  const row={status:mapped,plan_key:catalog?.plan_key ?? "basic",stripe_price_id:priceId,
    billing_interval:item?.price.recurring?.interval==="year"?"annual":"monthly",
    current_period_start:item?new Date(item.current_period_start*1000).toISOString():null,
    current_period_end:item?new Date(item.current_period_end*1000).toISOString():null,
    grace_ends_at:mapped==="past_due"?new Date(Date.now()+7*86400000).toISOString():null,
    cancel_at_period_end:subscription.cancel_at_period_end,updated_at:new Date().toISOString()};
  const {data:existing}=await supabaseAdmin.from("organization_subscriptions").select("organization_id,plan_key,status,current_period_end,scheduled_plan_key,founder_ends_at").eq("stripe_subscription_id",subscription.id).maybeSingle();
  if(!existing)return;
  const founderActive=Boolean(existing.status==="founder_complimentary"&&existing.founder_ends_at&&new Date(existing.founder_ends_at).getTime()>Date.now());
  if(founderActive){Object.assign(row,{status:"founder_complimentary",plan_key:"pro",scheduled_plan_key:catalog?.plan_key??existing.scheduled_plan_key});}
  const waitingForScheduledChange=Boolean(existing.scheduled_plan_key&&existing.current_period_end&&new Date(existing.current_period_end).getTime()>Date.now());
  if(waitingForScheduledChange) row.plan_key=existing.plan_key;
  else if(existing.scheduled_plan_key){ Object.assign(row,{scheduled_plan_key:null,scheduled_interval:null}); }
  const {error}=await supabaseAdmin.from("organization_subscriptions").update(row).eq("organization_id",existing.organization_id);
  if(error)throw new Error(error.message);
  if(mapped==="active"&&!waitingForScheduledChange&&!founderActive)await supabaseAdmin.from("org_plans").update({plan:row.plan_key,updated_at:new Date().toISOString()}).eq("organization_id",existing.organization_id);
}
