import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state=vi.hoisted(()=>({db:null as any,signed:vi.fn()}));
vi.mock("@/lib/supabaseAdmin",()=>({supabaseAdmin:{from:(...args:any[])=>state.db.from(...args),storage:{from:()=>({createSignedUrl:state.signed})}}}));
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import { requireOrgOperator } from "@/lib/schedule/admin_auth";
import { resolveOrgByToken,loadOrgBranding } from "@/lib/schedule/public";
beforeEach(()=>{state.db=database();state.signed.mockReset();state.signed.mockResolvedValue({data:{signedUrl:"https://example.invalid/logo"},error:null});});
describe("schedule persistence and public links",()=>{
 it("reuses the existing month",async()=>{state.db.queue("schedule_months",{data:{id:"month"}});expect(await ensureScheduleMonth("org","2026-09")).toEqual({ok:true,monthRow:{id:"month"}});expect(state.db.calls.some((c:any)=>c.method==="insert")).toBe(false);});
 it("creates a visible open month with its actor",async()=>{state.db.queue("schedule_months",{},{data:{id:"month"}});expect((await ensureScheduleMonth("org","2026-09","actor")).ok).toBe(true);expect(state.db.calls.find((c:any)=>c.method==="insert").args[0]).toMatchObject({org_id:"org",month:"2026-09",created_by:"actor",draft_open:true,is_public_visible:true});});
 it("returns database failures",async()=>{state.db.queue("schedule_months",{error:{message:"offline"}});expect(await ensureScheduleMonth("org","2026-09")).toEqual({ok:false,error:"offline"});});
 it.each(["owner","admin","finance","member","viewer"])("checks scheduling operator %s",async role=>{state.db.queue("user_organizations",{data:{role}});expect((await requireOrgOperator("actor","org")).ok).toBe(["owner","admin","finance"].includes(role));});
 it("rejects invalid and revoked public links",async()=>{expect(await resolveOrgByToken("bad")).toMatchObject({ok:false,status:404});state.db.queue("schedule_public_tokens",{data:{org_id:"org",is_active:false}});expect(await resolveOrgByToken("old")).toMatchObject({ok:false,status:410});});
 it("resolves an active public link",async()=>{state.db.queue("schedule_public_tokens",{data:{org_id:"org",is_active:true}});expect(await resolveOrgByToken("good")).toEqual({ok:true,org_id:"org",is_active:true});});
 it("uses a custom logo only when selected",async()=>{state.db.queue("organizations",{data:{id:"org",name:"Church"}});state.db.queue("organization_settings",{data:{use_default_logo:false,logo_path:"org/logo.png"}});expect(await loadOrgBranding("org")).toMatchObject({ok:true,org:{name:"Church",settings:{logo_url:"https://example.invalid/logo"}}});});
 it("tolerates missing optional branding settings",async()=>{state.db.queue("organizations",{data:{id:"org",name:"Church"}});expect(await loadOrgBranding("org")).toMatchObject({ok:true,org:{settings:{use_default_logo:true,logo_url:null}}});});
});
