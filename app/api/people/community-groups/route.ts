import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { apiStatus, directoryMembers, fetchAll, requirePeopleOperator } from "@/lib/server/people/directory";

const roles = new Set(["member", "assistant_leader", "leader"]);
const clean = (v: unknown) => typeof v === "string" ? v.trim() : "";

export async function GET(req: Request) {
  try {
    const orgId = new URL(req.url).searchParams.get("org_id") ?? "";
    await requirePeopleOperator(req, orgId);
    const [groups, memberships, members] = await Promise.all([
      fetchAll<Record<string, unknown>>((f,t) => supabaseAdmin.from("community_groups").select("id,name,description,meeting_day,meeting_time,meeting_location,status,created_at,updated_at").eq("org_id",orgId).order("name").range(f,t)),
      fetchAll<Record<string, unknown>>((f,t) => supabaseAdmin.from("community_group_members").select("group_id,member_id,role,status,joined_at,removed_at").eq("org_id",orgId).range(f,t)),
      directoryMembers(orgId),
    ]);
    return NextResponse.json({ groups, memberships, members });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to load groups.";
    return NextResponse.json({ error: message }, { status: apiStatus(message) });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const orgId = clean(body.org_id); const { actorId } = await requirePeopleOperator(req, orgId);
    const action = clean(body.action);
    if (action === "save_group") {
      const name = clean(body.name); if (!name) throw new Error("Group name is required.");
      const payload = { org_id:orgId,name,description:clean(body.description)||null,meeting_day:body.meeting_day==null?null:Number(body.meeting_day),meeting_time:clean(body.meeting_time)||null,meeting_location:clean(body.meeting_location)||null,updated_by:actorId,updated_at:new Date().toISOString() };
      const id = clean(body.id);
      const query = id ? supabaseAdmin.from("community_groups").update(payload).eq("id",id).eq("org_id",orgId) : supabaseAdmin.from("community_groups").insert({ ...payload, created_by:actorId });
      const { data,error } = await query.select("id").single(); if(error) throw new Error(error.message);
      await supabaseAdmin.from("people_membership_events").insert({org_id:orgId,entity_type:"community_group",entity_id:data.id,action:id?"updated":"created",actor_id:actorId});
    } else if (action === "set_group_status") {
      const id=clean(body.id), status=clean(body.status); if(!["active","archived"].includes(status)) throw new Error("Invalid status.");
      const {error}=await supabaseAdmin.from("community_groups").update({status,updated_by:actorId,updated_at:new Date().toISOString()}).eq("id",id).eq("org_id",orgId); if(error) throw new Error(error.message);
      await supabaseAdmin.from("people_membership_events").insert({org_id:orgId,entity_type:"community_group",entity_id:id,action:status,actor_id:actorId});
    } else if (action === "set_members") {
      const groupId=clean(body.group_id), role=clean(body.role)||"member"; if(!roles.has(role)) throw new Error("Invalid role.");
      const memberIds=Array.isArray(body.member_ids)?body.member_ids.map(clean).filter(Boolean):[]; if(!memberIds.length) throw new Error("Select at least one member.");
      const rows=memberIds.map(member_id=>({group_id:groupId,member_id,org_id:orgId,role,status:"active",removed_at:null,updated_by:actorId,created_by:actorId}));
      const {error}=await supabaseAdmin.from("community_group_members").upsert(rows,{onConflict:"group_id,member_id"}); if(error) throw new Error(error.message);
      await supabaseAdmin.from("people_membership_events").insert(memberIds.map(member_id=>({org_id:orgId,entity_type:"community_group",entity_id:groupId,member_id,action:"assigned",role,actor_id:actorId})));
    } else if (action === "update_member") {
      const groupId=clean(body.group_id),memberId=clean(body.member_id),role=clean(body.role),status=clean(body.status);
      if(!roles.has(role)||!["active","removed"].includes(status)) throw new Error("Invalid membership.");
      const {error}=await supabaseAdmin.from("community_group_members").update({role,status,removed_at:status==="removed"?new Date().toISOString():null,updated_by:actorId,updated_at:new Date().toISOString()}).eq("group_id",groupId).eq("member_id",memberId).eq("org_id",orgId); if(error) throw new Error(error.message);
      await supabaseAdmin.from("people_membership_events").insert({org_id:orgId,entity_type:"community_group",entity_id:groupId,member_id:memberId,action:status==="removed"?"removed":"updated",role,actor_id:actorId});
    } else throw new Error("Invalid action.");
    return NextResponse.json({ok:true});
  } catch(cause) { const message=cause instanceof Error?cause.message:"Unable to save group."; return NextResponse.json({error:message},{status:apiStatus(message)}); }
}
