import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireNikkyContext, nikkyErrorResponse } from "@/lib/server/nikky/auth";

export const runtime="nodejs";
type Params={params:Promise<{artifactId:string}>};

export async function GET(req:Request,{params}:Params){
  try{
    const context=await requireNikkyContext(req); const {artifactId}=await params;
    const {data,error}=await supabaseAdmin.from("nikky_report_artifacts").select("id,storage_path,status,expires_at,filename").eq("id",artifactId).eq("organization_id",context.organizationId).eq("user_id",context.userId).maybeSingle();
    if(error)throw new Error(error.message);
    if(!data||data.status!=="ready"||data.expires_at<=new Date().toISOString())return Response.json({error:"Not found"},{status:404});
    const downloaded=await supabaseAdmin.storage.from("nikky-reports").download(data.storage_path);
    if(downloaded.error)throw new Error(downloaded.error.message);
    return new Response(await downloaded.data.arrayBuffer(),{headers:{
      "Content-Type":data.filename.endsWith(".pdf")?"application/pdf":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="${data.filename.replaceAll('"','')}"`,
      "Cache-Control":"private, no-store",
    }});
  }catch(error){return nikkyErrorResponse(error);}
}
