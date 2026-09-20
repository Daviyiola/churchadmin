"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type ServiceOption = { id:string;name:string };
export default function ServiceCombobox({orgId,value,services,onChange,onCreated,allowCreate=true,initialOpen=false}:{orgId:string;value:string;services:ServiceOption[];onChange:(id:string)=>void;onCreated?:(service:ServiceOption)=>void;allowCreate?:boolean;initialOpen?:boolean}){
 const selected=services.find((s)=>s.id===value);const [query,setQuery]=useState(selected?.name??"");const [open,setOpen]=useState(initialOpen);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const matches=useMemo(()=>services.filter((s)=>s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0,12),[services,query]);
 const exact=services.some((s)=>s.name.trim().toLowerCase()===query.trim().toLowerCase());
 async function create(){
  const name=query.trim();if(!name||!confirm(`Create ?${name}? as a new service?`))return;
  setBusy(true);setError("");
  try {
   const {data}=await supabase.auth.getSession();
   if(!data.session?.access_token)throw new Error("Sign in again to create a service.");
   const res=await fetch("/api/services",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`,"x-organization-id":orgId},body:JSON.stringify({name}),signal:AbortSignal.timeout(15000)});
   const body=await res.json();if(!res.ok)throw new Error(body.error||"Unable to create service.");
   onCreated?.(body.service);onChange(body.service.id);setQuery(body.service.name);setOpen(false);
  }catch(error){setError(error instanceof Error?error.message:"Unable to create service. Please try again.");}
  finally{setBusy(false);}
 }

 return <div className="relative"><input value={open?query:(selected?.name??query)} onFocus={()=>{setQuery(selected?.name??query);setOpen(true)}} onChange={(e)=>{setQuery(e.target.value);setOpen(true);setError("")}} placeholder="Search services…" className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30"/>{open?<div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border bg-white p-1 shadow-lg">{matches.map((service)=><button type="button" key={service.id} onClick={()=>{onChange(service.id);setQuery(service.name);setOpen(false)}} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50">{service.name}</button>)}{allowCreate&&!exact&&query.trim()?<button type="button" disabled={busy} onClick={()=>void create()} className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-primary/5">+ Create “{query.trim()}”</button>:null}{!matches.length&&!query.trim()?<div className="px-3 py-2 text-sm text-slate-500">Start typing a service name.</div>:null}</div>:null}{error?<p className="mt-1 text-xs text-red-600">{error}</p>:null}</div>;
}
