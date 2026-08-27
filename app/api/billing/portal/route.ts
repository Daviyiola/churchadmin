import { requireBillingActor } from "@/lib/server/billing/auth";
import { getStripe } from "@/lib/server/billing/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
export async function POST(req:Request){try{const body=await req.json() as {organization_id?:string};const org=String(body.organization_id??"");await requireBillingActor(req,org,true);
 const {data}=await supabaseAdmin.from("organization_subscriptions").select("stripe_customer_id").eq("organization_id",org).maybeSingle();if(!data?.stripe_customer_id)throw new Error("No paid billing account is connected yet.");
 const appUrl=String(process.env.NEXT_PUBLIC_APP_URL??new URL(req.url).origin).replace(/\/$/,"");const session=await getStripe().billingPortal.sessions.create({customer:data.stripe_customer_id,return_url:`${appUrl}/app/settings/billing`});return Response.json({url:session.url});
}catch(error){const m=error instanceof Error?error.message:"Unable to open billing.";return Response.json({error:m},{status:m==="UNAUTHORIZED"?401:m==="FORBIDDEN"?403:400});}}
