"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Item={id:string;name:string;role:string;primary?:boolean};
export default function PersonCommunityServing({memberId}:{memberId:string}){
 const [groups,setGroups]=useState<Item[]>([]),[departments,setDepartments]=useState<Item[]>([]),[open,setOpen]=useState(false);
 useEffect(()=>{let alive=true;(async()=>{const [{data:gLinks},{data:dLinks}]=await Promise.all([
  supabase.from("community_group_members").select("group_id,role").eq("member_id",memberId).eq("status","active"),
  supabase.from("member_departments").select("department_category_id,role,is_primary").eq("member_id",memberId).eq("status","active")]);
  const gids=(gLinks??[]).map(x=>x.group_id),dids=(dLinks??[]).map(x=>x.department_category_id);
  const [{data:gs},{data:ds}]=await Promise.all([gids.length?supabase.from("community_groups").select("id,name").in("id",gids):Promise.resolve({data:[]}),dids.length?supabase.from("categories").select("id,name").in("id",dids):Promise.resolve({data:[]})]);
  if(!alive)return;const gn=new Map((gs??[]).map(x=>[x.id,x.name])),dn=new Map((ds??[]).map(x=>[x.id,x.name]));
  setGroups((gLinks??[]).map(x=>({id:x.group_id,name:gn.get(x.group_id)??"Community group",role:x.role})));
  setDepartments((dLinks??[]).map(x=>({id:x.department_category_id,name:dn.get(x.department_category_id)??"Department",role:x.role,primary:x.is_primary})));
 })();return()=>{alive=false};},[memberId]);
 return <div className="rounded-2xl border"><button type="button" onClick={()=>setOpen(x=>!x)} className="flex w-full items-center justify-between px-4 py-3 text-left"><span><span className="block text-sm font-semibold">Community &amp; Serving</span><span className="block text-xs text-slate-500">{groups.length} groups · {departments.length} departments</span></span><span>{open?"−":"+"}</span></button>{open?<div className="grid gap-4 border-t p-4 sm:grid-cols-2"><div><div className="text-xs font-semibold uppercase text-slate-500">Community groups</div>{groups.length?<div className="mt-2 flex flex-wrap gap-2">{groups.map(x=><span key={x.id} className="rounded-full border bg-slate-50 px-3 py-1 text-xs">{x.name} · {x.role.replace("_"," ")}</span>)}</div>:<p className="mt-2 text-sm text-slate-500">No group memberships.</p>}<Link href="/app/people/community-groups" className="mt-3 inline-block text-xs font-semibold underline">Manage groups</Link></div><div><div className="text-xs font-semibold uppercase text-slate-500">Worker departments</div>{departments.length?<div className="mt-2 flex flex-wrap gap-2">{departments.map(x=><span key={x.id} className="rounded-full border bg-slate-50 px-3 py-1 text-xs">{x.name}{x.primary?" · Primary":""} · {x.role.replace("_"," ")}</span>)}</div>:<p className="mt-2 text-sm text-slate-500">No department memberships.</p>}<Link href="/app/people/worker-departments" className="mt-3 inline-block text-xs font-semibold underline">Manage departments</Link></div></div>:null}</div>;
}
