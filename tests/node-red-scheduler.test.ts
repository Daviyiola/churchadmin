import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const nodes=JSON.parse(readFileSync("node-red/church-admin-scheduled-followups.json","utf8")) as Array<{id:string;type:string;func?:string}>;
function execute(id:string,msg:Record<string,unknown>,secret?:string){const node={status:vi.fn(),error:vi.fn()};const code=nodes.find(n=>n.id===id)!.func!;const result=runInNewContext(`(function(){${code}\n})()`,{msg,node,env:{get:()=>secret}},{timeout:1000});return {result,node};}
describe("Node-RED scheduled followups",()=>{
 it("does not make a request without the scheduler secret",()=>{const {result,node}=execute("ca-followups-prepare",{});expect(result).toBeNull();expect(node.error).toHaveBeenCalled();});
 it("puts credentials in the header rather than the URL",()=>{const {result}=execute("ca-followups-prepare",{}," test-secret ");expect(result.headers.authorization).toBe("Bearer test-secret");expect(result.url).not.toContain("test-secret");expect(result.url).toContain("limit=10");});
 it("summarizes results without exposing recipient data or headers",()=>{const {result}=execute("ca-followups-check",{headers:{authorization:"secret"},requestHeaders:{authorization:"secret"},responseUrl:"private",statusCode:200,payload:{ok:true,sent:2,results:[{status:"blocked_preference",email:"private@example.invalid"}]}});expect(result[0].payload).toMatchObject({ok:true,sent:2,blocked_preference:1});expect(result[0].headers).toBeUndefined();expect(JSON.stringify(result)).not.toContain("private@example.invalid");});
 it.each([401,429,500])("routes status %s to the error output",status=>{const {result}=execute("ca-followups-check",{statusCode:status,payload:{error:"Unavailable"}});expect(result[0]).toBeNull();expect(result[1].payload).toMatchObject({ok:false,statusCode:status,error:"Unavailable"});});
 it("removes credentials from caught errors",()=>{const {result}=execute("ca-followups-clean-error",{headers:{authorization:"secret"},requestHeaders:{authorization:"secret"},error:{message:"Timeout"}});expect(result.headers).toBeUndefined();expect(result.requestHeaders).toBeUndefined();expect(result.payload).toEqual({ok:false,error:"Timeout"});});
});
