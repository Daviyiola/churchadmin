import { nikkyErrorResponse, requireSelectedNikkyMembership } from "@/lib/server/nikky/auth";

export const runtime="nodejs";
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req:Request){
  try{
    const actor=await requireSelectedNikkyMembership(req);const month=new URL(req.url).searchParams.get("month")??"";
    if(!MONTH.test(month))return Response.json({error:"month must be YYYY-MM"},{status:400});
    const [monthResult,categories]=await Promise.all([
      actor.supabase.from("schedule_months").select("id,month").eq("org_id",actor.organizationId).eq("month",month).maybeSingle(),
      actor.supabase.from("categories").select("id,name,type").eq("org_id",actor.organizationId).eq("status","active").in("type",["services","department"]).order("name"),
    ]);
    if(monthResult.error)throw new Error(monthResult.error.message);if(categories.error)throw new Error(categories.error.message);
    let requirements:unknown[]=[];if(monthResult.data){const rows=await actor.supabase.from("schedule_coverage_requirements").select("id,requirement_date,service_category_id,department_category_id,role,required_count").eq("org_id",actor.organizationId).eq("month_id",monthResult.data.id).order("requirement_date");if(rows.error)throw new Error(rows.error.message);requirements=rows.data??[];}
    return Response.json({month_id:monthResult.data?.id??null,categories:categories.data??[],requirements});
  }catch(error){return nikkyErrorResponse(error);}
}

export async function POST(req:Request){
  try{
    const actor=await requireSelectedNikkyMembership(req);const body=(await req.json()) as Record<string,unknown>;
    if(body.action==="delete"){
      if(Object.keys(body).some(k=>!["action","requirement_id"].includes(k))||typeof body.requirement_id!=="string")return Response.json({error:"Invalid delete request."},{status:400});
      const {error}=await actor.supabase.rpc("delete_schedule_coverage_requirement",{p_requirement_id:body.requirement_id});if(error)throw new Error(error.message);return new Response(null,{status:204});
    }
    const allowed=["action","month_id","requirement_date","service_category_id","department_category_id","role","required_count"];
    if(Object.keys(body).some(k=>!allowed.includes(k))||body.action!=="upsert")return Response.json({error:"Invalid requirement request."},{status:400});
    const {data,error}=await actor.supabase.rpc("upsert_schedule_coverage_requirement",{p_month_id:body.month_id,p_requirement_date:body.requirement_date,p_service_category_id:body.service_category_id,p_department_category_id:body.department_category_id,p_role:body.role,p_required_count:body.required_count});
    if(error)throw new Error(error.message);return Response.json({requirement:data});
  }catch(error){return nikkyErrorResponse(error);}
}
