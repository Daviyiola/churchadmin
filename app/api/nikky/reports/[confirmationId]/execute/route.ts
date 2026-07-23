import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { appendNikkyAudit } from "@/lib/server/nikky/audit";
import { requireNikkyContext, nikkyErrorResponse } from "@/lib/server/nikky/auth";
import { enforceFinanceWindow } from "@/lib/server/nikky/dates";
import { buildReportData, canonicalizeReportParameters, renderReport, reportFilename, reportParametersHash, REPORT_REGISTRY } from "@/lib/server/reports/registry";
import { consumeReportRateLimit } from "@/lib/server/nikky/limits";

export const runtime = "nodejs";
export const maxDuration = 60;
type Params = { params: Promise<{ confirmationId: string }> };

export async function POST(req:Request,{params}:Params){
  const started=Date.now();
  try{
    const context=await requireNikkyContext(req);
    if((await req.text()).trim())return Response.json({error:"Report execution accepts no parameters."},{status:400});
    await consumeReportRateLimit(context);
    const {confirmationId}=await params;
    const now=new Date().toISOString();
    const {data:confirmation,error:readError}=await supabaseAdmin.from("nikky_report_confirmations").select("*").eq("id",confirmationId).eq("organization_id",context.organizationId).eq("user_id",context.userId).maybeSingle();
    if(readError)throw new Error(readError.message);
    if(!confirmation)return Response.json({error:"Not found"},{status:404});
    if(confirmation.role_snapshot!==context.role)return Response.json({error:"Your role changed. Prepare a new report preview."},{status:403});
    if(confirmation.expires_at<=now)return Response.json({error:"This report preview expired. Prepare it again."},{status:409});
    if(!["pending","failed"].includes(confirmation.status)||Number(confirmation.attempt_count)>=2)return Response.json({error:"This confirmation cannot be reused."},{status:409});
    const canonical=canonicalizeReportParameters(context,confirmation.canonical_parameters as Record<string,unknown>);
    if(reportParametersHash(canonical)!==confirmation.parameters_hash)return Response.json({error:"The confirmed report parameters failed integrity validation."},{status:409});
    if(REPORT_REGISTRY[canonical.report_type].financial)enforceFinanceWindow(context,canonical.start_date);
    const {data:claimed,error:claimError}=await supabaseAdmin.from("nikky_report_confirmations").update({status:"executing",attempt_count:Number(confirmation.attempt_count)+1}).eq("id",confirmationId).eq("status",confirmation.status).eq("attempt_count",confirmation.attempt_count).select("id").maybeSingle();
    if(claimError)throw new Error(claimError.message);
    if(!claimed)return Response.json({error:"This confirmation is already being used."},{status:409});

    const filename=reportFilename(canonical); const storagePath=`${context.organizationId}/${context.userId}/${confirmationId}/${filename}`;
    const {data:artifact,error:artifactError}=await supabaseAdmin.from("nikky_report_artifacts").insert({organization_id:context.organizationId,user_id:context.userId,conversation_id:confirmation.conversation_id,report_type:canonical.report_type,format:canonical.format,filename,storage_path:storagePath,status:"generating"}).select("id").single();
    if(artifactError)throw new Error(artifactError.message);
    try{
      const data=await buildReportData(context,canonical); const rendered=await renderReport(context,canonical,data);
      const uploaded=await supabaseAdmin.storage.from("nikky-reports").upload(storagePath,rendered.bytes,{contentType:rendered.contentType,upsert:false});
      if(uploaded.error)throw new Error(uploaded.error.message);
      await Promise.all([
        supabaseAdmin.from("nikky_report_artifacts").update({status:"ready",record_count:data.recordCount,ready_at:new Date().toISOString()}).eq("id",artifact.id),
        supabaseAdmin.from("nikky_report_confirmations").update({status:"complete",artifact_id:artifact.id,executed_at:new Date().toISOString()}).eq("id",confirmationId),
      ]);
      await appendNikkyAudit(context,{conversationId:confirmation.conversation_id,reportType:canonical.report_type,confirmationId,artifactId:artifact.id,applied:canonical,authorizationOutcome:"allowed",outcome:"report_ready",classifications:[REPORT_REGISTRY[canonical.report_type].classification],recordCount:data.recordCount,durationMs:Date.now()-started});
      return Response.json({artifact:{id:artifact.id,filename,format:canonical.format,report_type:canonical.report_type,status:"ready",record_count:data.recordCount,expires_at:new Date(Date.now()+24*60*60_000).toISOString()}});
    }catch(error){
      await Promise.all([supabaseAdmin.from("nikky_report_artifacts").update({status:"failed",error_code:"generation_failed"}).eq("id",artifact.id),supabaseAdmin.from("nikky_report_confirmations").update({status:"failed"}).eq("id",confirmationId)]);
      throw error;
    }
  }catch(error){return nikkyErrorResponse(error);}
}
