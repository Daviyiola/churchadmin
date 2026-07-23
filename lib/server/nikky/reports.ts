import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { appendNikkyAudit } from "@/lib/server/nikky/audit";
import type { NikkyContext, NikkyToolResult } from "@/lib/server/nikky/types";
import { REPORT_REGISTRY, canonicalizeReportParameters, reportParametersHash } from "@/lib/server/reports/registry";
import type { NikkyToolDefinition } from "@/lib/server/nikky/tools";

const nullableStringArray = { anyOf: [{ type: "array", items: { type: "string" }, maxItems: 100 }, { type: "null" }] };
export const reportToolDefinitions: NikkyToolDefinition[] = [
  { type:"function",name:"list_reports",description:"List existing downloadable reports available to the current verified role.",strict:true,parameters:{type:"object",properties:{},required:[],additionalProperties:false}},
  { type:"function",name:"prepare_report_preview",description:"Validate and prepare an immutable downloadable report preview. This does not generate the report. The user must confirm using the UI card.",strict:true,parameters:{type:"object",properties:{
    report_type:{type:"string",enum:Object.keys(REPORT_REGISTRY)},format:{type:"string",enum:["pdf","csv"]},start_date:{type:"string"},end_date:{type:"string"},detail_level:{type:"string",enum:["summary","detailed"]},include_archived:{type:"boolean"},joined:{type:"string",enum:["all","joined","not_joined"]},service_ids:nullableStringArray,category_ids:nullableStringArray,payment_methods:nullableStringArray,member_id:{anyOf:[{type:"string",format:"uuid"},{type:"null"}]},
  },required:["report_type","format","start_date","end_date","detail_level","include_archived","joined","service_ids","category_ids","payment_methods","member_id"],additionalProperties:false}},
];

function result(outcome:NikkyToolResult["outcome"],applied:Record<string,unknown>,data:unknown,count=0,message?:string):NikkyToolResult{return{outcome,evidence_id:randomUUID(),applied,record_count:count,data,message};}

export async function executeReportTool(context:NikkyContext,conversationId:string,name:string,args:Record<string,unknown>) {
  if(name==="list_reports") {
    const reports=Object.entries(REPORT_REGISTRY).filter(([,d])=>d.roles.includes(context.role)).map(([id,d])=>({report_type:id,name:d.name,description:d.description,formats:["pdf","csv"]}));
    await appendNikkyAudit(context,{conversationId,toolName:name,authorizationOutcome:"allowed",outcome:"ok",classifications:["report_catalog"],recordCount:reports.length});
    return result("ok",{},reports,reports.length);
  }
  if(name!=="prepare_report_preview") throw new Error("Unknown report tool.");
  try {
    const canonical=canonicalizeReportParameters(context,args);
    const definition=REPORT_REGISTRY[canonical.report_type];
    const hash=reportParametersHash(canonical);
    const {data,error}=await supabaseAdmin.from("nikky_report_confirmations").insert({organization_id:context.organizationId,user_id:context.userId,conversation_id:conversationId,role_snapshot:context.role,report_type:canonical.report_type,format:canonical.format,canonical_parameters:canonical,parameters_hash:hash,access_classification:definition.classification}).select("id,expires_at").single();
    if(error)throw new Error(error.message);
    await appendNikkyAudit(context,{conversationId,reportType:canonical.report_type,confirmationId:data.id,requested:{report_type:args.report_type,format:args.format},applied:canonical,authorizationOutcome:"allowed",outcome:"preview_created",classifications:[definition.classification]});
    return result("ok",canonical,{confirmation_id:data.id,expires_at:data.expires_at,report_name:definition.name,description:definition.description,parameters:canonical,requires_button_confirmation:true,sensitivity:definition.classification,record_count_available:false},0,"The preview is ready for explicit confirmation. Report rows have not been queried yet, so no matching-record count is available.");
  } catch(error) {
    const outside=error instanceof Error&&error.name==="OutsideFinanceWindowError";
    const message=error instanceof Error?error.message:"Report preview failed.";
    const policyRejected=/not available for your role|cannot target|requires an unambiguous|does not accept|invalid|unsupported|unknown report parameter|must be PDF or CSV/i.test(message);
    const outcome=outside?"outside_finance_window":policyRejected?"forbidden":"calculation_failed";
    await appendNikkyAudit(context,{conversationId,toolName:name,reportType:typeof args.report_type==="string"?args.report_type:undefined,requested:{report_type:args.report_type,format:args.format},authorizationOutcome:outside||policyRejected?"denied":"allowed",outcome,errorCode:outside?"outside_finance_window":policyRejected?"report_policy_rejected":"report_preview_error",classifications:["report_preview"],recordCount:0});
    return result(outcome,{},null,0,message);
  }
}
