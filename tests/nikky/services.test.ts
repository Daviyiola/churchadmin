import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "../helpers/database";
import type { NikkyContext } from "@/lib/server/nikky/types";
const state=vi.hoisted(()=>({db:null as any,rpc:vi.fn()}));
vi.mock("@/lib/supabaseAdmin",()=>({supabaseAdmin:{from:(...args:any[])=>state.db.from(...args),rpc:state.rpc}}));
import { enforceNikkyBudget,consumeChatRateLimit,consumeReportRateLimit,acquireNikkyRequestSlot,releaseNikkyRequestSlot,recordNikkyUsage } from "@/lib/server/nikky/limits";
import { listConversations,createConversation,conversationMessages,renameConversation,deleteConversation,addMessage } from "@/lib/server/nikky/repository";
import { createContextSelectionHandle,verifyContextSelectionHandle } from "@/lib/server/nikky/signing";
const context={organizationId:"org",userId:"user",timezone:"UTC",monthlyBudgetCents:50} as NikkyContext;
beforeEach(()=>{state.db=database();state.rpc.mockReset();state.rpc.mockResolvedValue({error:null});process.env.NIKKY_CONTEXT_SIGNING_SECRET="unit-test-signing-secret-at-least-32-characters";});
describe("assistant budget and request slots",()=>{
 it("sums monthly usage in micros against cents",async()=>{state.db.queue("nikky_usage_monthly",{data:[{estimated_cost_micros:100000},{estimated_cost_micros:150000}]});expect(await enforceNikkyBudget(context)).toEqual({usedMicros:250000,budgetMicros:500000,percentage:50});});
 it("blocks at the exact budget limit",async()=>{state.db.queue("nikky_usage_monthly",{data:[{estimated_cost_micros:500000}]});await expect(enforceNikkyBudget(context)).rejects.toMatchObject({status:429,code:"budget_exhausted"});});
 it.each([consumeChatRateLimit,consumeReportRateLimit,acquireNikkyRequestSlot])("turns exceeded concurrency/rate limits into retryable errors",async action=>{state.rpc.mockResolvedValue({error:{message:"LIMIT"}});await expect(action(context)).rejects.toMatchObject({status:429,code:"rate_limited"});});
 it("acquires and releases the same unique slot",async()=>{const id=await acquireNikkyRequestSlot(context);expect(id).toMatch(/^[a-f0-9-]{36}$/);await releaseNikkyRequestSlot(id);expect(state.rpc).toHaveBeenLastCalledWith("release_nikky_request_slot",{p_request_id:id});});
 it("accounts separately for cached input, output, and tools",async()=>{await recordNikkyUsage(context,{inputTokens:10,cachedInputTokens:5,outputTokens:20,toolCalls:2,estimatedCostMicros:100});expect(state.rpc.mock.calls[0][1]).toMatchObject({p_organization_id:"org",p_user_id:"user",p_input:10,p_cached:5,p_output:20,p_tool_calls:2,p_cost:100});});
});
describe("assistant conversation ownership",()=>{
 it("scopes conversation lists to both tenant and user",async()=>{expect(await listConversations(context)).toEqual([]);expect(state.db.calls).toContainEqual({table:"nikky_conversations",method:"eq",args:["organization_id","org"]});expect(state.db.calls).toContainEqual({table:"nikky_conversations",method:"eq",args:["user_id","user"]});});
 it("creates the greeting with the conversation",async()=>{state.db.queue("nikky_conversations",{data:{id:"c"}});expect(await createConversation(context)).toEqual({id:"c"});expect(state.db.calls.find((c:any)=>c.table==="nikky_messages"&&c.method==="insert").args[0]).toMatchObject({conversation_id:"c",organization_id:"org",user_id:"user",role:"assistant"});});
 it("cleans up a conversation when greeting creation fails",async()=>{state.db.queue("nikky_conversations",{data:{id:"c"}},{});state.db.queue("nikky_messages",{error:{message:"write failed"}});await expect(createConversation(context)).rejects.toThrow("write failed");expect(state.db.calls.some((c:any)=>c.table==="nikky_conversations"&&c.method==="delete")).toBe(true);});
 it("does not read messages from an inaccessible conversation",async()=>{expect(await conversationMessages(context,"private")).toBeNull();expect(state.db.from).not.toHaveBeenCalledWith("nikky_messages");});
 it("returns messages after checking ownership",async()=>{state.db.queue("nikky_conversations",{data:{id:"c"}});state.db.queue("nikky_messages",{data:[{id:"m",content:"Hello"}]});expect((await conversationMessages(context,"c"))?.messages).toHaveLength(1);});
 it("scopes renaming to both tenant and user",async()=>{await renameConversation(context,"c","New title");expect(state.db.calls).toContainEqual({table:"nikky_conversations",method:"eq",args:["user_id","user"]});});
 it("does not delete inaccessible conversations",async()=>{expect(await deleteConversation(context,"private")).toBe(false);expect(state.db.calls.some((c:any)=>c.method==="delete")).toBe(false);});
 it("persists message provenance and failed status",async()=>{state.db.queue("nikky_messages",{data:{id:"m"}});await addMessage(context,"c","assistant","Answer",{status:"failed",evidenceIds:["e"],model:"test"});expect(state.db.calls.find((c:any)=>c.method==="insert").args[0]).toMatchObject({status:"failed",evidence_ids:["e"],model:"test"});});
});
describe("signed organization-selection handles",()=>{
 it("binds the selected organization to a user",()=>{const token=createContextSelectionHandle("user","org");expect(verifyContextSelectionHandle(token,"user")?.organization_id).toBe("org");expect(verifyContextSelectionHandle(token,"other")).toBeNull();});
 it.each(["", "a", "a.b.c", "bad.signature"])("rejects malformed handle %s",token=>expect(verifyContextSelectionHandle(token,"user")).toBeNull());
 it("rejects expired and tampered handles",()=>{expect(verifyContextSelectionHandle(createContextSelectionHandle("user","org",-1),"user")).toBeNull();const token=createContextSelectionHandle("user","org");expect(verifyContextSelectionHandle(`${token}x`,"user")).toBeNull();});
});
