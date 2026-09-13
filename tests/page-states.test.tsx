// @vitest-environment jsdom
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
const state=vi.hoisted(()=>({push:vi.fn(),replace:vi.fn(),role:"owner",mutations:[] as string[]}));
vi.mock("next/navigation",()=>{const router={push:state.push,replace:state.replace,back:vi.fn(),refresh:vi.fn()};const search=new URLSearchParams();const params={formId:"form-1"};return {redirect:(path:string)=>{throw new Error(`redirect:${path}`);},useRouter:()=>router,usePathname:()=>"/app",useSearchParams:()=>search,useParams:()=>params};});
vi.mock("next/image",()=>({default:({unoptimized,priority,fill,...props}:any)=><img {...props}/>}));
vi.mock("@/components/TipTap",()=>({default:()=> <div aria-label="Rich text editor"/>,TipTap:()=> <div aria-label="Rich text editor"/>}));
vi.mock("@/app/providers",()=>({useGlobalModal:()=>({openModal:vi.fn(),closeModal:vi.fn()})}));
vi.mock("@/lib/supabaseClient",()=>{
 const client:any={};
 client.from=(table:string)=>{
  let single=false;
  const fixtures:Record<string,unknown>={organizations:{id:"org",name:"Test Church",created_at:"2026-01-01"},organization_settings:{use_default_logo:true,timezone_name:"UTC",timezone_confirmed:true},user_organizations:{role:state.role,user_id:"user",organization_id:"org"},org_plans:{plan:"free"}};
  const query:any={then:(resolve:any,reject:any)=>Promise.resolve({data:single?(fixtures[table]??null):[],error:null,count:0}).then(resolve,reject)};
  for(const method of ["select","eq","neq","is","in","or","not","gte","lte","gt","lt","order","range","limit","ilike","contains","filter","match"])query[method]=()=>query;
  query.single=query.maybeSingle=()=>{single=true;return query;};
  for(const method of ["insert","upsert","update","delete"])query[method]=()=>{state.mutations.push(`${table}:${method}`);return query;};
  return query;
 };
 client.auth={getSession:async()=>({data:{session:{access_token:"test-token",user:{id:"user",email:"owner@example.invalid"}}}}),getUser:async()=>({data:{user:{id:"user",email:"owner@example.invalid"}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}}),signOut:vi.fn()};
 client.storage={from:()=>({getPublicUrl:()=>({data:{publicUrl:"/logo.ico"}}),createSignedUrl:async()=>({data:{signedUrl:"/logo.ico"}})})};
 client.rpc=async()=>({data:[],error:null});client.channel=()=>({on(){return this;},subscribe(){return this;}});client.removeChannel=vi.fn();
 return {supabase:client};
});
function pages(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?pages(join(dir,entry.name)):entry.name==="page.tsx"?[join(dir,entry.name).replaceAll("\\","/")]:[]);}
const cases=[...pages("app/app"),"app/page.tsx","app/pricing/page.tsx","app/signin/page.tsx","app/get-started/page.tsx","app/contact/page.tsx","app/terms/page.tsx","app/privacy/page.tsx","app/auth/update-password/page.tsx"];
beforeEach(()=>{
 localStorage.clear();localStorage.setItem("active_org_id","org");localStorage.setItem("active_org_role",state.role);state.push.mockClear();state.replace.mockClear();state.mutations.length=0;
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:"Service temporarily unavailable"}),{status:503,headers:{"Content-Type":"application/json"}})));
 vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
 vi.stubGlobal("IntersectionObserver",class{observe(){}unobserve(){}disconnect(){}});
 window.scrollTo=vi.fn();HTMLElement.prototype.scrollIntoView=vi.fn();window.matchMedia=vi.fn().mockReturnValue({matches:false,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});
});
afterEach(cleanup);
describe("every app page: empty organization / API outage rendering",()=>{
 it.each(cases)("%s renders a usable state without an uncaught failure",async path=>{
  const {default:Page}=await import(/* @vite-ignore */ `../${path}`);
  if(path==="app/app/people/sms-communications/page.tsx"){expect(()=>Page()).toThrow("redirect:/app/communications/sms");return;}
  const result=render(<Page/>);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});
  expect(result!.container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  expect(result!.container.textContent).not.toMatch(/undefined is not|TypeError|\[object Object\]/);
  expect(result!.container.textContent?.trim()).not.toMatch(/^Loading(?:…|\.{3})?$/);
  // Empty data must never cause a render path to delete records.
  expect(state.mutations.filter(value=>value.endsWith(":delete"))).toEqual([]);
 },30000);
});
