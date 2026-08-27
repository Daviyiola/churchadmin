import { requireBillingActor } from "@/lib/server/billing/auth";
import { getOrganizationEntitlements } from "@/lib/server/planEntitlements";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req:Request){
 try{
  const organizationId=new URL(req.url).searchParams.get("organization_id")?.trim()??""; if(!organizationId)throw new Error("Organization is required.");
  const actor=await requireBillingActor(req,organizationId); const entitlements=await getOrganizationEntitlements(organizationId);
  const month=new Date().toISOString().slice(0,7)+"-01";
  const [members,visitors,managers,invites,forms,email,nikky,subscription]=await Promise.all([
   supabaseAdmin.from("members").select("id",{count:"exact",head:true}).eq("org_id",organizationId).eq("membership_stage","member").eq("status","active"),
   supabaseAdmin.from("members").select("id",{count:"exact",head:true}).eq("org_id",organizationId).eq("membership_stage","visitor").eq("status","active"),
   supabaseAdmin.from("user_organizations").select("id",{count:"exact",head:true}).eq("organization_id",organizationId).in("role",["owner","admin","finance"]),
   supabaseAdmin.from("invites").select("id",{count:"exact",head:true}).eq("organization_id",organizationId).in("role",["owner","admin","finance"]).is("used_at",null).gt("expires_at",new Date().toISOString()),
   supabaseAdmin.from("forms").select("id",{count:"exact",head:true}).eq("org_id",organizationId).eq("is_system",false),
   supabaseAdmin.from("org_email_usage_month").select("used").eq("organization_id",organizationId).eq("month_bucket",month).maybeSingle(),
   supabaseAdmin.from("nikky_usage_monthly").select("estimated_cost_micros").eq("organization_id",organizationId).eq("usage_month",month),
   supabaseAdmin.from("organization_subscriptions").select("plan_key,billing_interval,status,current_period_end,grace_ends_at,cancel_at_period_end,scheduled_plan_key,scheduled_interval,founder_ends_at,stripe_customer_id,stripe_subscription_id").eq("organization_id",organizationId).maybeSingle(),
  ]);
  const failed=[members,visitors,managers,invites,forms,email,nikky,subscription].find((result)=>result.error); if(failed?.error)throw new Error(failed.error.message);
  return Response.json({ role:actor.role,plan:entitlements.plan,subscription:subscription.data,usage:{
   members:{used:members.count??0,limit:entitlements.memberCountLimit},first_timers:{used:visitors.count??0,limit:entitlements.firstTimerCountLimit},
   management_seats:{used:(managers.count??0)+(invites.count??0),limit:entitlements.managementSeatLimit},forms:{used:forms.count??0,limit:entitlements.formCountLimit},
   emails:{used:Number(email.data?.used??0),limit:entitlements.emailMonthlyLimit},nikky:{used_cents:Math.ceil((nikky.data??[]).reduce((sum,row)=>sum+Number(row.estimated_cost_micros??0),0)/10000),limit_cents:entitlements.nikkyMonthlyBudgetCents},
  }});
 }catch(error){const message=error instanceof Error?error.message:"Unable to load billing.";return Response.json({error:message},{status:message==="UNAUTHORIZED"?401:message==="FORBIDDEN"?403:400});}
}
