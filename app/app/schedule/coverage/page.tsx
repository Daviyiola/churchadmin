"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";

type Category = { id: string; name: string; type: "services" | "department" };
type Target = { id: string; is_default: boolean; requirement_date: string | null; service_category_id: string; department_category_id: string; role: string; required_count: number };
type Scope = "default" | "date";
type PendingCategory = { type: "services" | "department"; name: string } | null;

function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
async function api(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? "Request failed"); }
  return response.status === 204 ? null : response.json();
}
function normalize(value: string) { return value.trim().toLocaleLowerCase().replace(/\s+/g, " "); }

function CategoryPicker({ label, type, categories, value, onChange, onAdd }: { label: string; type: Category["type"]; categories: Category[]; value: string; onChange: (id: string) => void; onAdd: (category: PendingCategory) => void }) {
  const selected = categories.find((category) => category.id === value);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const matches = categories.filter((category) => category.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 8);
  const exact = categories.some((category) => normalize(category.name) === normalize(query));
  return <label className="relative block min-w-0 text-sm font-medium text-slate-700">
    <span className="mb-1.5 block">{label}</span>
    <input value={query} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { setQuery(event.target.value); onChange(""); setOpen(true); }} placeholder={`Search ${label.toLocaleLowerCase()}`} className="w-full rounded-xl border bg-white px-3 py-2.5 font-normal outline-none focus:ring-2 focus:ring-primary/30" />
    {open ? <div className="absolute z-20 mt-2 max-h-56 w-full overflow-auto rounded-2xl border bg-white py-1 shadow-lg">
      {matches.map((category) => <button key={category.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(category.id); setQuery(category.name); setOpen(false); }} className="block w-full px-3 py-2 text-left font-normal hover:bg-slate-50">{category.name}</button>)}
      {query.trim() && !exact ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); onAdd({ type, name: query.trim() }); }} className="block w-full border-t px-3 py-2 text-left font-semibold text-primary hover:bg-slate-50">+ Add {type === "services" ? "service" : "department"} “{query.trim()}”</button> : null}
      {!matches.length && !query.trim() ? <div className="px-3 py-2 font-normal text-slate-500">Start typing to search.</div> : null}
    </div> : null}
  </label>;
}

export default function StaffingTargetsPage() {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("default");
  const [month, setMonth] = useState(currentMonth());
  const [monthId, setMonthId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [defaults, setDefaults] = useState<Target[]>([]);
  const [dateTargets, setDateTargets] = useState<Target[]>([]);
  const [date, setDate] = useState(`${currentMonth()}-01`);
  const [service, setService] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("member");
  const [count, setCount] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<PendingCategory>(null);
  const services = useMemo(() => categories.filter((category) => category.type === "services"), [categories]);
  const departments = useMemo(() => categories.filter((category) => category.type === "department"), [categories]);
  const names = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const rows = scope === "default" ? defaults : dateTargets;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await api(`/api/schedule/coverage?month=${month}`);
      setMonthId(data.month_id); setCategories(data.categories); setDefaults(data.default_targets); setDateTargets(data.date_targets);
      setDate((current) => current.startsWith(month) ? current : `${month}-01`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load staffing targets"); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!service || !department) { setError("Choose a service and department."); return; }
    if (scope === "date" && !monthId) { setError("Open this month on the Schedule page first so it can be initialized."); return; }
    setSaving(true); setError("");
    try {
      await api("/api/schedule/coverage", { method: "POST", body: JSON.stringify({ action: "upsert", scope, month_id: monthId, requirement_date: scope === "date" ? date : null, service_category_id: service, department_category_id: department, role, required_count: count }) });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Save failed"); }
    finally { setSaving(false); }
  }
  async function remove(id: string) { try { await api("/api/schedule/coverage", { method: "POST", body: JSON.stringify({ action: "delete", requirement_id: id }) }); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Delete failed"); } }
  async function createCategory() {
    if (!pendingCategory) return;
    setSaving(true); setError("");
    try {
      const data = await api("/api/schedule/coverage", { method: "POST", body: JSON.stringify({ action: "create_category", ...pendingCategory }) });
      const category = data.category as Category;
      setCategories((current) => [...current.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name)));
      if (category.type === "services") setService(category.id); else setDepartment(category.id);
      setPendingCategory(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Category could not be created"); }
    finally { setSaving(false); }
  }

  return <>
    <div className="border-b px-6 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-xl font-semibold">Staffing targets</h1><p className="text-sm text-slate-600">Set reusable staffing expectations, then add exact-date exceptions when needed.</p></div>
        <button onClick={() => router.push("/app/schedule")} className="w-fit rounded-2xl border bg-white px-4 py-2 text-sm hover:bg-slate-50">Back to Schedule</button>
      </div>
    </div>
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-2xl border bg-slate-50 p-1">
          <button onClick={() => setScope("default")} className={`rounded-xl px-4 py-2 text-sm ${scope === "default" ? "border bg-white font-semibold shadow-sm" : "text-slate-600"}`}>Default targets</button>
          <button onClick={() => setScope("date")} className={`rounded-xl px-4 py-2 text-sm ${scope === "date" ? "border bg-white font-semibold shadow-sm" : "text-slate-600"}`}>Date overrides</button>
        </div>
        {scope === "date" ? <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-fit rounded-2xl border bg-white px-3 py-2" /> : null}
      </div>
      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">{scope === "default" ? "Default targets apply whenever that service appears on the schedule." : "A date override replaces the matching default target for that service, department, and role on one date."}</div>
      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="rounded-3xl border bg-white p-5">
        <div className={`grid gap-4 ${scope === "date" ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
          {scope === "date" ? <label className="text-sm font-medium text-slate-700"><span className="mb-1.5 block">Date</span><input type="date" min={`${month}-01`} max={`${month}-31`} value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 font-normal" /></label> : null}
          <CategoryPicker label="Service" type="services" categories={services} value={service} onChange={setService} onAdd={setPendingCategory} />
          <CategoryPicker label="Department" type="department" categories={departments} value={department} onChange={setDepartment} onAdd={setPendingCategory} />
          <label className="text-sm font-medium text-slate-700"><span className="mb-1.5 block">Role</span><select value={role} onChange={(event) => setRole(event.target.value)} className="w-full rounded-xl border bg-white px-3 py-2.5 font-normal"><option value="lead">Lead</option><option value="asst">Assistant</option><option value="member">Member</option></select></label>
          <label className="text-sm font-medium text-slate-700"><span className="mb-1.5 block">People needed</span><input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} className="w-full rounded-xl border px-3 py-2.5 font-normal" /></label>
          <div className="flex items-end"><button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Add or update"}</button></div>
        </div>
      </div>
      <div className="overflow-hidden rounded-3xl border bg-white">
        {loading ? <div className="p-5 text-sm text-slate-500">Loading…</div> : rows.length === 0 ? <div className="p-5 text-sm text-slate-500">No {scope === "default" ? "default targets" : "date overrides"} configured.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{scope === "date" ? <th className="px-5 py-3">Date</th> : null}<th className="px-5 py-3">Service</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">People needed</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map((target) => <tr key={target.id}>{scope === "date" ? <td className="px-5 py-4">{target.requirement_date}</td> : null}<td className="px-5 py-4 font-medium">{names.get(target.service_category_id) ?? "Unknown service"}</td><td className="px-5 py-4">{names.get(target.department_category_id) ?? "Unknown department"}</td><td className="px-5 py-4 capitalize">{target.role === "asst" ? "Assistant" : target.role}</td><td className="px-5 py-4">{target.required_count}</td><td className="px-5 py-4 text-right"><button onClick={() => remove(target.id)} className="text-red-600 hover:underline">Delete</button></td></tr>)}</tbody></table></div>}
      </div>
    </div>
    {pendingCategory ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold">Add {pendingCategory.type === "services" ? "service" : "department"}?</h2><p className="mt-2 text-sm text-slate-600">“{pendingCategory.name}” will be added to this organization and become available throughout Church Admin.</p><div className="mt-6 flex justify-end gap-2"><button onClick={() => setPendingCategory(null)} className="rounded-xl border px-4 py-2 text-sm">Cancel</button><button onClick={createCategory} disabled={saving} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Adding…" : "Add category"}</button></div></div></div> : null}
  </>;
}
