import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state=vi.hoisted(()=>({db:null as any,actor:vi.fn()}));
vi.mock("@/lib/supabaseAdmin",()=>({supabaseAdmin:{from:(...args:any[])=>state.db.from(...args)}}));
vi.mock("@/lib/server/authUser",()=>({requireActorId:state.actor}));
vi.mock("@/lib/server/attendance/checkin",()=>({requireAttendanceStaff:async()=>({userId:"actor",role:"owner"}),routeError:(error:any)=>Response.json({error:error.message},{status:400})}));
vi.mock("@/lib/server/people/directory",async original=>({...await original<object>(),requirePeopleOperator:async()=>({actorId:"actor",role:"owner"})}));
import { POST as service } from "@/app/api/services/route";
import { POST as group } from "@/app/api/people/community-groups/route";
import { POST as department } from "@/app/api/people/worker-departments/route";
import { GET as preferences, PATCH as savePreferences } from "@/app/api/account/email-preferences/route";
const req=(body:unknown)=>new Request("http://localhost",{method:"POST",headers:{"Content-Type":"application/json","x-organization-id":"org"},body:JSON.stringify(body)});
beforeEach(()=>{state.db=database();state.actor.mockResolvedValue("actor");});
describe("service category creation",()=>{
 it("creates a normalized service for the authorized organization",async()=>{state.db.queue("categories",{},{data:{id:"s",name:"Sunday Worship"}});expect((await service(req({name:" Sunday   Worship "}))).status).toBe(201);expect(state.db.calls.find((c:any)=>c.method==="insert").args[0]).toMatchObject({org_id:"org",name:"Sunday Worship",type:"services",created_by:"actor"});});
 it("reuses an active service with the same normalized name",async()=>{state.db.queue("categories",{data:{id:"s",name:"Sunday",status:"active"}});expect((await service(req({name:"Sunday"}))).status).toBe(200);expect(state.db.calls.some((c:any)=>c.method==="insert")).toBe(false);});
 it("does not silently restore an archived service",async()=>{state.db.queue("categories",{data:{id:"s",status:"archived"}});expect((await service(req({name:"Sunday"}))).status).toBe(409);});
 it("recovers a concurrently created matching service",async()=>{state.db.queue("categories",{},{error:{message:"duplicate"}},{data:{id:"s",status:"active"}});expect((await service(req({name:"Sunday"}))).status).toBe(200);});
 it.each([{name:""},{name:"x".repeat(101)},{name:"Sunday",org_id:"other"}])("rejects invalid creation %j",async body=>{expect((await service(req(body))).status).toBe(400);expect(state.db.calls.some((c:any)=>c.method==="insert")).toBe(false);});
});
describe("community groups and worker departments",()=>{
 it("creates a group with its audit record",async()=>{state.db.queue("community_groups",{data:{id:"g"}});expect((await group(req({org_id:"org",action:"save_group",name:" Care Group "}))).status).toBe(200);expect(state.db.calls.find((c:any)=>c.table==="community_groups"&&c.method==="insert").args[0]).toMatchObject({org_id:"org",name:"Care Group",created_by:"actor"});expect(state.db.calls.some((c:any)=>c.table==="people_membership_events"&&c.method==="insert")).toBe(true);});
 it.each([group,department])("rejects invalid membership roles and empty assignments",async handler=>{expect((await handler(req({org_id:"org",action:"set_members",role:"owner",member_ids:["m"]}))).status).toBe(400);expect((await handler(req({org_id:"org",action:"set_members",role:"member",member_ids:[]}))).status).toBe(400);});
 it("assigns group members without replacing organization ownership",async()=>{expect((await group(req({org_id:"org",action:"set_members",group_id:"g",role:"leader",member_ids:["m1","m2"]}))).status).toBe(200);const rows=state.db.calls.find((c:any)=>c.method==="upsert").args[0];expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({org_id:"org",group_id:"g",role:"leader",status:"active"});});
 it("marks removed group memberships with a timestamp",async()=>{await group(req({org_id:"org",action:"update_member",group_id:"g",member_id:"m",role:"member",status:"removed"}));expect(state.db.calls.find((c:any)=>c.method==="update").args[0]).toMatchObject({status:"removed",removed_at:expect.any(String)});});
 it("requires workers to be removed before department archival",async()=>{state.db.queue("member_departments",{count:2});expect((await department(req({org_id:"org",action:"set_department_status",id:"d",status:"archived"}))).status).toBe(400);expect(state.db.calls.some((c:any)=>c.method==="update")).toBe(false);});
 it("creates a department with the correct category type",async()=>{expect((await department(req({org_id:"org",action:"save_department",name:"Choir"}))).status).toBe(200);expect(state.db.calls.find((c:any)=>c.method==="insert").args[0]).toMatchObject({org_id:"org",name:"Choir",type:"department"});});
 it.each([group,department])("rejects unknown actions",async handler=>expect((await handler(req({org_id:"org",action:"delete_everything"}))).status).toBe(400));
});
describe("account email preference API",()=>{
 it("defaults unset preferences to enabled",async()=>expect(await (await preferences(new Request("http://localhost"))).json()).toEqual({product_updates:true,onboarding_tips:true}));
 it("preserves explicit opt-outs",async()=>{state.db.queue("user_email_preferences",{data:{product_updates:false,onboarding_tips:false}});expect(await (await preferences(new Request("http://localhost"))).json()).toEqual({product_updates:false,onboarding_tips:false});});
 it.each([{}, {product_updates:"false",onboarding_tips:true}, {product_updates:false}])("requires actual booleans %j",async body=>expect((await savePreferences(req(body))).status).toBe(400));
 it("ignores a caller-supplied user ID",async()=>{expect((await savePreferences(req({user_id:"other",product_updates:false,onboarding_tips:true}))).status).toBe(200);expect(state.db.calls.find((c:any)=>c.method==="upsert").args[0].user_id).toBe("actor");});
});
