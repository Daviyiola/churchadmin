import { requireActorId } from "@/lib/server/authUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const userId=await requireActorId(req); const sessionId=new URL(req.url).searchParams.get("session_id");
    if(!sessionId)return Response.json({error:"Missing session."},{status:400});
    const {data,error}=await supabaseAdmin.from("owner_onboarding_intents").select("status,provisioned_organization_id")
      .eq("user_id",userId).eq("stripe_checkout_session_id",sessionId).maybeSingle();
    if(error)throw new Error(error.message); if(!data)return Response.json({error:"Not found."},{status:404});
    return Response.json(data);
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to check onboarding."},{status:401});}
}
