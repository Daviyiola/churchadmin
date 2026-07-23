"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAccessToken, getActiveOrgRole } from "@/lib/auth";
import { normalizeNikkyMarkdown } from "@/lib/nikkyMarkdown";
import { nikkyStarters } from "@/lib/nikkyStarters";
import NikkyInfoModal from "@/components/nikky/NikkyInfoModal";
import NikkyUnavailableModal from "@/components/nikky/NikkyUnavailableModal";

type Conversation={id:string;title:string;updated_at:string};
type Message={id:string;role:"user"|"assistant";content:string;status:string;created_at:string};
type Confirmation={id:string;report_type:string;format:"pdf"|"csv";canonical_parameters:Record<string,unknown>;access_classification:string;expires_at:string;status:string;artifact_id?:string|null};
type Artifact={id:string;report_type:string;format:string;filename:string;status:string;record_count:number|null;expires_at:string};

const reportMeta:Record<string,{name:string;description:string}>={
  quick_income:{name:"Quick Income",description:"Income by donor and category for the selected period."},
  quick_expense:{name:"Quick Expense",description:"Expense entries by date, category, vendor, and amount."},
  quick_attendance:{name:"Quick Attendance",description:"Published attendance for the selected period."},
  income_statement:{name:"Income Statement",description:"Income, expenses, and net income grouped by category."},
  member_giving:{name:"Member Giving",description:"Giving for the selected member."},
  first_timers:{name:"First-Timers",description:"Visitors whose first visit falls in the selected period."},
  baptisms:{name:"Baptisms",description:"Members baptized in the selected period."},
  new_converts:{name:"New Converts",description:"Members marked born again in the selected period."},
  combined:{name:"Converts & Baptisms",description:"Converts and baptisms in the selected period."},
};

function ReportPreviewCard({item,generating,onConfirm}:{item:Confirmation;generating:boolean;onConfirm:()=>void}){
  const p=item.canonical_parameters; const meta=reportMeta[item.report_type]??{name:item.report_type.replaceAll("_"," "),description:"Church Admin report."};
  const detail=String(p.detail_level??"summary"); const joined=String(p.joined??"all");
  const chips=[String(item.format).toUpperCase(),detail==="detailed"?"Detailed":"Summary"];
  const filters:Array<[string,string]>=[];
  if(Array.isArray(p.service_ids)&&p.service_ids.length)filters.push(["Services",`${p.service_ids.length} selected`]);
  if(Array.isArray(p.category_ids)&&p.category_ids.length)filters.push(["Categories",`${p.category_ids.length} selected`]);
  if(Array.isArray(p.payment_methods)&&p.payment_methods.length)filters.push(["Methods",p.payment_methods.join(", ")]);
  if(item.report_type==="first_timers")filters.push(["Joined",joined==="all"?"All":joined.replaceAll("_"," ")]);
  if(["first_timers","baptisms","new_converts","combined"].includes(item.report_type))filters.push(["Records",p.include_archived===false?"Active only":"Active and archived"]);
  return <div className="overflow-hidden rounded-3xl border border-amber-300 bg-white shadow-sm">
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Report preview</div><h3 className="mt-1 text-lg font-semibold text-slate-900">{meta.name}</h3><p className="mt-1 text-sm text-slate-600">{meta.description}</p></div><div className="flex gap-2">{chips.map(chip=><span key={chip} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">{chip}</span>)}</div></div></div>
    <div className="space-y-4 p-5"><div><div className="text-xs font-medium uppercase tracking-wide text-slate-500">Reporting period</div><div className="mt-1 font-semibold text-slate-900">{String(p.start_date)} <span className="font-normal text-slate-400">to</span> {String(p.end_date)}</div></div>
      {filters.length>0&&<div className="grid gap-3 sm:grid-cols-2">{filters.map(([name,value])=><div key={name} className="rounded-2xl bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">{name}</div><div className="mt-1 text-sm font-medium capitalize text-slate-800">{value}</div></div>)}</div>}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">This report will use current Church Admin data when you confirm. Its parameters are locked to this preview.</div>
      <button disabled={generating} onClick={onConfirm} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">{generating?"Generating report…":"Confirm and generate"}</button>
    </div>
  </div>;
}

const loadingPhrases=["Sit tight—checking your request","Checking what I can safely access","Putting together a clear answer"];

class NikkyApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "NikkyApiError";
  }
}

async function api(path:string,init:RequestInit={}){
  const token=await getAccessToken();
  const headers=new Headers(init.headers); if(token)headers.set("Authorization",`Bearer ${token}`); if(init.body)headers.set("Content-Type","application/json");
  const response=await fetch(path,{...init,headers});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new NikkyApiError(body.error??"Request failed.",body.code??"request_failed",response.status);}
  if(response.status===204)return null; return response.json();
}

function AssistantMessage({content}:{content:string}){
  const markdown=normalizeNikkyMarkdown(content);
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p:({children})=><p className="mb-2 last:mb-0">{children}</p>,
      ul:({children})=><ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
      ol:({children})=><ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
      strong:({children})=><strong className="font-semibold text-slate-900">{children}</strong>,
      table:({children})=><div className="my-3 max-w-full overflow-x-auto rounded-2xl border border-slate-200"><table className="min-w-full border-collapse bg-white text-left text-sm">{children}</table></div>,
      thead:({children})=><thead className="bg-slate-100 text-slate-700">{children}</thead>,
      tbody:({children})=><tbody className="divide-y divide-slate-100">{children}</tbody>,
      tr:({children})=><tr className="align-top">{children}</tr>,
      th:({children})=><th className="whitespace-nowrap px-4 py-2.5 font-semibold">{children}</th>,
      td:({children})=><td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{children}</td>,
      a:({children})=><span>{children}</span>,
    }}
  >{markdown}</ReactMarkdown>;
}

function ConversationLoading({initial=false}:{initial?:boolean}){
  return <div className={initial?"min-h-screen bg-slate-50 p-4 md:p-6":"py-4"}>
    <div className={`mx-auto w-full ${initial?"max-w-5xl":"max-w-3xl"}`}>
      {initial&&<div className="mb-4 h-20 animate-pulse rounded-3xl border bg-white" />}
      <div className="rounded-3xl border bg-white p-5 md:p-6">
        <div className="mb-7 flex items-center gap-3 text-sm text-slate-500"><span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-30"/><span className="relative inline-flex h-3 w-3 rounded-full bg-primary"/></span>Opening conversation…</div>
        <div className="space-y-5" aria-hidden="true">
          <div className="flex justify-start"><div className="w-[72%] animate-pulse space-y-2 rounded-3xl bg-slate-100 p-4"><div className="h-3 w-4/5 rounded-full bg-slate-200"/><div className="h-3 w-3/5 rounded-full bg-slate-200"/></div></div>
          <div className="flex justify-end"><div className="h-11 w-[42%] animate-pulse rounded-3xl bg-primary/20"/></div>
          <div className="flex justify-start"><div className="w-[64%] animate-pulse space-y-2 rounded-3xl bg-slate-100 p-4"><div className="h-3 w-full rounded-full bg-slate-200"/><div className="h-3 w-2/3 rounded-full bg-slate-200"/><div className="h-3 w-1/2 rounded-full bg-slate-200"/></div></div>
        </div>
      </div>
    </div>
  </div>;
}

export default function NikkyPage(){
  const role=getActiveOrgRole();
  const [conversations,setConversations]=useState<Conversation[]>([]); const [selected,setSelected]=useState<string|null>(null);
  const [messages,setMessages]=useState<Message[]>([]); const [confirmations,setConfirmations]=useState<Confirmation[]>([]); const [artifacts,setArtifacts]=useState<Artifact[]>([]);
  const [input,setInput]=useState(""); const [loading,setLoading]=useState(true); const [sending,setSending]=useState(false); const [generatingConfirmationId,setGeneratingConfirmationId]=useState<string|null>(null); const [error,setError]=useState(""); const [warning,setWarning]=useState(""); const [loadingIndex,setLoadingIndex]=useState(0);
  const [reportsExpanded,setReportsExpanded]=useState(false);
  const [conversationLoading,setConversationLoading]=useState(false);
  const [infoOpen,setInfoOpen]=useState(false);
  const [notEnabled,setNotEnabled]=useState(false);
  const conversationRequest=useRef(0);
  const chatScrollRef=useRef<HTMLElement|null>(null);
  const starters=useMemo(()=>nikkyStarters(role,new Date().getDate()),[role]);

  const loadConversation=useCallback(async(id:string)=>{const request=++conversationRequest.current;setSelected(id);setConversationLoading(true);setError("");try{const data=await api(`/api/nikky/conversations/${id}`);if(request!==conversationRequest.current)return;setMessages(data.messages??[]);setConfirmations(data.confirmations??[]);setArtifacts(data.artifacts??[]);setReportsExpanded(false);}finally{if(request===conversationRequest.current)setConversationLoading(false);}},[]);
  const refreshList=useCallback(async()=>{const data=await api("/api/nikky/conversations");setConversations(data.conversations??[]);return data.conversations??[] as Conversation[];},[]);
  const create=useCallback(async()=>{setError("");const data=await api("/api/nikky/conversations",{method:"POST"});await refreshList();await loadConversation(data.conversation.id);},[loadConversation,refreshList]);

  useEffect(()=>{(async()=>{try{const list=await refreshList();if(list[0])await loadConversation(list[0].id);else await create();}catch(e){if(e instanceof NikkyApiError&&e.code==="not_enabled"){setNotEnabled(true);setError("");}else{setError(e instanceof Error?e.message:"Unable to open Nikky.");}}finally{setLoading(false);}})();},[create,loadConversation,refreshList]);
  useEffect(()=>{if(!sending)return;const timer=window.setInterval(()=>setLoadingIndex(v=>(v+1)%loadingPhrases.length),1800);return()=>window.clearInterval(timer);},[sending]);
  useEffect(()=>{if(conversationLoading)return;const frame=window.requestAnimationFrame(()=>{const panel=chatScrollRef.current;if(panel)panel.scrollTo({top:panel.scrollHeight,behavior:"auto"});});return()=>window.cancelAnimationFrame(frame);},[conversationLoading,messages.length,confirmations.length,artifacts.length,selected]);

  async function send(event?:FormEvent,starter?:string){event?.preventDefault();const text=(starter??input).trim();if(!text||!selected||sending||conversationLoading)return;const temporaryId=`temp-${Date.now()}`;setInput("");setError("");setWarning("");setSending(true);setMessages(old=>[...old,{id:temporaryId,role:"user",content:text,status:"complete",created_at:new Date().toISOString()}]);try{const data=await api(`/api/nikky/conversations/${selected}/messages`,{method:"POST",body:JSON.stringify({message:text})});setMessages(old=>[...old.map(m=>m.id===temporaryId?(data.user_message??m):m),data.message]);setWarning(data.usage_warning??"");if(data.confirmations?.length)setConfirmations(old=>[...old.filter((c:Confirmation)=>!data.confirmations.some((n:Confirmation)=>n.id===c.id)),...data.confirmations]);await refreshList();}catch(e){setMessages(old=>old.filter(m=>m.id!==temporaryId));if(e instanceof NikkyApiError&&e.code==="not_enabled"){setNotEnabled(true);setError("");}else{setError(e instanceof Error?e.message:"Nikky couldn't answer.");}}finally{setSending(false);}}
  async function confirm(item:Confirmation){try{setError("");setGeneratingConfirmationId(item.id);const data=await api(`/api/nikky/reports/${item.id}/execute`,{method:"POST"});setConfirmations(old=>old.map(c=>c.id===item.id?{...c,status:"complete",artifact_id:data.artifact.id}:c));setArtifacts(old=>[...old.filter(a=>a.id!==data.artifact.id),data.artifact]);setReportsExpanded(true);}catch(e){setError(e instanceof Error?e.message:"Report generation failed.");}finally{setGeneratingConfirmationId(null);}}
  async function download(artifact:Artifact){try{setError("");const token=await getAccessToken();const response=await fetch(`/api/nikky/downloads/${artifact.id}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error("Download is unavailable or expired.");const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=artifact.filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);}catch(e){setError(e instanceof Error?e.message:"Download failed.");}}
  async function rename(item:Conversation){const title=window.prompt("Conversation name",item.title)?.trim();if(!title)return;try{await api(`/api/nikky/conversations/${item.id}`,{method:"PATCH",body:JSON.stringify({title})});await refreshList();}catch(e){setError(e instanceof Error?e.message:"Rename failed.");}}
  async function remove(item:Conversation){if(!window.confirm(`Delete “${item.title}”? This removes the saved conversation but not its audit log.`))return;try{await api(`/api/nikky/conversations/${item.id}`,{method:"DELETE"});const list=await refreshList();if(list[0])await loadConversation(list[0].id);else await create();}catch(e){setError(e instanceof Error?e.message:"Delete failed.");}}

  if(loading)return <ConversationLoading initial/>;
  return <div className="relative flex min-h-screen bg-slate-50">
    <aside className="hidden w-72 shrink-0 border-r bg-white p-4 lg:block"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Conversations</h2><button onClick={create} className="rounded-xl bg-primary px-3 py-2 text-sm text-white shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md hover:brightness-105 active:translate-y-0 active:scale-95">New</button></div><div className="space-y-2">{conversations.map(c=><div key={c.id} className={`group relative overflow-hidden rounded-2xl border transition duration-150 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-slate-50 hover:shadow-sm ${selected===c.id?"border-primary bg-slate-50":"bg-white"}`}><button type="button" aria-label={`Open ${c.title}`} className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onClick={()=>loadConversation(c.id)}/><div className="pointer-events-none relative z-[1] p-3"><div className="flex items-center gap-2 text-left text-sm font-medium"><span className="min-w-0 flex-1 truncate">{c.title}</span>{conversationLoading&&selected===c.id&&<span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"/>}</div><div className="pointer-events-auto relative z-10 mt-2 flex gap-3 text-xs text-slate-500"><button type="button" onClick={()=>rename(c)} className="rounded px-1 py-0.5 transition hover:bg-white hover:text-slate-900">Rename</button><button type="button" onClick={()=>remove(c)} className="rounded px-1 py-0.5 text-red-600 transition hover:bg-red-50 hover:text-red-700">Delete</button></div></div></div>)}</div></aside>
    <main className="mx-auto flex h-screen w-full max-w-5xl flex-col p-4 md:p-6"><header className="mb-4 flex items-center justify-between rounded-3xl border bg-white px-5 py-4"><div><h1 className="text-xl font-semibold">Nikky</h1><div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"><span>Read-only Church Admin assistant</span><button type="button" onClick={()=>setInfoOpen(true)} className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">Learn more</button></div></div><button onClick={create} className="rounded-2xl border px-4 py-2 text-sm shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-primary hover:shadow-md active:translate-y-0 active:scale-95 lg:hidden">New chat</button></header>
      {error&&<div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {warning&&<div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{warning}</div>}
      <section ref={chatScrollRef} className="flex-1 overflow-y-auto rounded-3xl border bg-white p-4 md:p-6">{conversationLoading?<ConversationLoading/>:<div className="mx-auto max-w-3xl space-y-4">{messages.map(m=><div key={m.id} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}><div className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-6 ${m.role==="user"?"whitespace-pre-wrap bg-primary text-white":"bg-slate-100 text-slate-800"}`}>{m.role==="assistant"?<AssistantMessage content={m.content}/>:m.content}</div></div>)}
        {messages.length<=1&&<div className="flex flex-wrap gap-2">{starters.map(text=><button key={text} onClick={()=>send(undefined,text)} className="rounded-full border bg-white px-4 py-2 text-left text-sm hover:border-primary">{text}</button>)}</div>}
        {confirmations.filter(c=>c.status==="pending").map(c=><ReportPreviewCard key={c.id} item={c} generating={generatingConfirmationId===c.id} onConfirm={()=>confirm(c)}/>)}
        {artifacts.some(a=>a.status==="ready")&&<div className="overflow-hidden rounded-3xl border border-emerald-200 bg-white"><button type="button" onClick={()=>setReportsExpanded(value=>!value)} className="flex w-full items-center justify-between gap-4 bg-emerald-50 px-5 py-4 text-left"><div><div className="font-semibold text-slate-900">Available reports</div><div className="text-xs text-slate-600">{artifacts.filter(a=>a.status==="ready").length} download{artifacts.filter(a=>a.status==="ready").length===1?"":"s"} ready</div></div><span className={`text-lg text-emerald-800 transition-transform ${reportsExpanded?"rotate-180":""}`}>⌄</span></button>{reportsExpanded&&<div className="divide-y">{artifacts.filter(a=>a.status==="ready").slice().reverse().map(a=><div key={a.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-900">{reportMeta[a.report_type]?.name??a.report_type.replaceAll("_"," ")}</div><div className="truncate text-xs text-slate-500">{a.filename} · {a.record_count??0} records · expires in 24 hours</div></div><button onClick={()=>download(a)} className="shrink-0 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Download {a.format.toUpperCase()}</button></div>)}</div>}</div>}
        {sending&&<div className="flex justify-start"><div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-600">{loadingPhrases[loadingIndex]}…</div></div>}
      </div>}</section>
      <form onSubmit={e=>send(e)} className="mt-4 flex gap-2 rounded-3xl border bg-white p-3"><textarea disabled={conversationLoading} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} maxLength={8000} rows={2} placeholder={conversationLoading?"Opening conversation…":"Ask about attendance, finances, members, follow-ups, schedules, or reports…"} className="min-h-12 flex-1 resize-none rounded-2xl border-0 px-3 py-2 text-sm outline-none disabled:bg-white disabled:text-slate-400"/><button disabled={sending||conversationLoading||!input.trim()} className="self-end rounded-2xl bg-primary px-5 py-3 text-sm text-white disabled:opacity-50">Send</button></form>
    </main>
    <NikkyInfoModal open={infoOpen} onClose={()=>setInfoOpen(false)}/>
    {notEnabled?<NikkyUnavailableModal/>:null}
  </div>;
}
