import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nikkyErrorResponse, requireSelectedNikkyMembership } from "@/lib/server/nikky/auth";
import { getOrganizationEntitlements } from "@/lib/server/planEntitlements";
import { isValidTimezone } from "@/lib/timezones";

export const runtime="nodejs";

function monthStartIso(timezone:string){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit"}).formatToParts(new Date());
  const year=parts.find(part=>part.type==="year")?.value;const month=parts.find(part=>part.type==="month")?.value;
  return `${year}-${month}-01`;
}

export async function GET(req:Request){
  try{
    const actor=await requireSelectedNikkyMembership(req);
    const {data,error}=await supabaseAdmin.from("organization_settings").select("timezone_name,timezone_confirmed,nikky_enabled").eq("organization_id",actor.organizationId).maybeSingle();
    if(error)throw new Error(error.message);
    const entitlements=await getOrganizationEntitlements(actor.organizationId);
    const usageMonth=monthStartIso(data?.timezone_name??"UTC");
    const {data:usage,error:usageError}=await supabaseAdmin.from("nikky_usage_monthly").select("estimated_cost_micros,request_count").eq("organization_id",actor.organizationId).eq("usage_month",usageMonth);
    if(usageError)throw new Error(usageError.message);
    const usedMicros=(usage??[]).reduce((sum,row)=>sum+Number(row.estimated_cost_micros??0),0);
    const requests=(usage??[]).reduce((sum,row)=>sum+Number(row.request_count??0),0);
    const budgetMicros=entitlements.nikkyMonthlyBudgetCents?entitlements.nikkyMonthlyBudgetCents*10_000:0;
    const percentage=budgetMicros?Math.min(100,Math.round((usedMicros/budgetMicros)*1000)/10):0;
    const warningLevel=percentage>=100?"paused":percentage>=90?"critical":percentage>=70?"warning":"normal";
    return Response.json({
      settings:{timezone_name:data?.timezone_name??null,timezone_confirmed:Boolean(data?.timezone_confirmed),nikky_enabled:Boolean(data?.nikky_enabled)},
      plan:entitlements.plan,
      usage:{month:usageMonth,percentage,warning_level:warningLevel,request_count:requests},
      custom_cap_configured:entitlements.nikkyBudgetSource!=="missing_enterprise_custom",
      openai_configured:Boolean(process.env.OPENAI_API_KEY),
      signing_configured:Boolean(process.env.NIKKY_CONTEXT_SIGNING_SECRET&&process.env.NIKKY_AUDIT_HMAC_SECRET),
    });
  }catch(error){return nikkyErrorResponse(error);}
}

export async function PUT(req:Request){
  try{
    const actor=await requireSelectedNikkyMembership(req);
    if(!["owner","admin"].includes(actor.role))return Response.json({error:"Forbidden"},{status:403});
    const body=(await req.json()) as Record<string,unknown>;
    const allowed=["nikky_enabled","timezone_name"];
    if(Object.keys(body).some(k=>!allowed.includes(k)))return Response.json({error:"Unknown setting."},{status:400});
    if(!Object.keys(body).length)return Response.json({error:"No settings supplied."},{status:400});
    if(body.nikky_enabled!==undefined&&typeof body.nikky_enabled!=="boolean")return Response.json({error:"Invalid Nikky setting value."},{status:400});
    if(body.timezone_name!==undefined&&body.timezone_name!==null&&typeof body.timezone_name!=="string")return Response.json({error:"Invalid timezone value."},{status:400});
    const requestedTimezone=typeof body.timezone_name==="string"?body.timezone_name.trim():body.timezone_name===null?"":undefined;
    if(requestedTimezone&& !isValidTimezone(requestedTimezone))return Response.json({error:"Choose a valid organization timezone."},{status:400});
    const entitlements=await getOrganizationEntitlements(actor.organizationId);
    const {data:current,error:currentError}=await supabaseAdmin.from("organization_settings").select("timezone_name,timezone_confirmed,nikky_enabled").eq("organization_id",actor.organizationId).single();
    if(currentError)throw new Error(currentError.message);
    const nextEnabled=typeof body.nikky_enabled==="boolean"?body.nikky_enabled:Boolean(current.nikky_enabled);
    const nextTimezone=requestedTimezone===undefined?current.timezone_name:requestedTimezone||null;
    if(nextEnabled&&!entitlements.nikkyMonthlyBudgetCents)return Response.json({error:"This Enterprise organization needs its negotiated Nikky allowance configured by Church Admin before Nikky can be enabled."},{status:409});
    if(nextEnabled&&(!nextTimezone||!process.env.OPENAI_API_KEY||!process.env.NIKKY_CONTEXT_SIGNING_SECRET||!process.env.NIKKY_AUDIT_HMAC_SECRET))return Response.json({error:"Save an organization timezone and configure all required server secrets before enabling Nikky."},{status:409});
    const {data,error}=await supabaseAdmin.from("organization_settings").update({
      nikky_enabled:nextEnabled,
      timezone_name:nextTimezone,
      timezone_confirmed:Boolean(nextTimezone),
    }).eq("organization_id",actor.organizationId).select("timezone_name,timezone_confirmed,nikky_enabled").single();
    if(error)throw new Error(error.message);return Response.json({settings:data});
  }catch(error){return nikkyErrorResponse(error);}
}
