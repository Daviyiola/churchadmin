import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime="nodejs";
export async function POST(req:Request){
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`)return Response.json({error:"Unauthorized"},{status:401});
  const now=new Date().toISOString();
  const {data,error}=await supabaseAdmin.from("nikky_report_artifacts").select("id,storage_path").lt("expires_at",now).neq("status","expired").limit(500);
  if(error)return Response.json({error:error.message},{status:500});
  const paths=(data??[]).map(row=>row.storage_path);
  if(paths.length){const removed=await supabaseAdmin.storage.from("nikky-reports").remove(paths);if(removed.error)return Response.json({error:removed.error.message},{status:500});await supabaseAdmin.from("nikky_report_artifacts").update({status:"expired"}).in("id",(data??[]).map(row=>row.id));}
  return Response.json({expired_artifacts:paths.length});
}

export const GET = POST;
