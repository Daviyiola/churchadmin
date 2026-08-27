"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Definition = { id: string; name: string; field_type: string; options: string[]; status: string };
type Payload = {
  definitions: Definition[];
  values: Array<{ custom_field_id: string; value: string | string[] | null }>;
  current_custom_ids: string[];
  current_standard_keys: string[];
  retired_standard_fields: Array<{ key: string; label: string; value: unknown }>;
  error?: string;
};

export type PersonCustomFieldSaveValue = {
  field_id: string;
  value: string | string[] | null;
};

async function headers() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Your session has expired.");
  return { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" };
}

function FieldControl({ definition, value, onChange }: { definition: Definition; value: string | string[]; onChange: (value: string | string[]) => void }) {
  const base = "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm";
  if (definition.field_type === "long_text") return <textarea rows={3} className={base} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  if (definition.field_type === "multiple_choice") {
    const selected = Array.isArray(value) ? value : [];
    return <div className="mt-2 grid gap-2 sm:grid-cols-2">{definition.options.map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(option)} onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>;
  }
  if (["single_choice", "dropdown", "yes_no"].includes(definition.field_type)) {
    const options = definition.field_type === "yes_no" ? ["yes", "no"] : definition.options;
    return <select className={base} value={String(value)} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  }
  const type = definition.field_type === "date" ? "date" : definition.field_type === "number" ? "number" : definition.field_type === "email" ? "email" : definition.field_type === "phone" ? "tel" : "text";
  return <input type={type} className={base} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

export default function PersonCustomFields({
  memberId,
  visitor = false,
  onStandardKeys,
  onValuesChange,
  onReadyChange,
  showSaveButton = true,
}: {
  memberId: string;
  visitor?: boolean;
  onStandardKeys?: (keys: string[]) => void;
  onValuesChange?: (values: PersonCustomFieldSaveValue[]) => void;
  onReadyChange?: (ready: boolean) => void;
  showSaveButton?: boolean;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      onReadyChange?.(false);
      setLoading(true); setMessage("");
      try {
        const response = await fetch(`/api/people/${memberId}/custom-fields`, { headers: await headers(), cache: "no-store" });
        const body = await response.json() as Payload;
        if (!response.ok) throw new Error(body.error || "Unable to load custom fields.");
        if (cancelled) return;
        setPayload(body);
        setValues(Object.fromEntries(body.values.map((item) => [item.custom_field_id, item.value ?? ""])));
        onStandardKeys?.(body.current_standard_keys);
        onReadyChange?.(true);
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Unable to load custom fields."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; onReadyChange?.(false); };
  }, [memberId, onReadyChange, onStandardKeys]);

  const { current, historical } = useMemo(() => {
    const definitions = payload?.definitions ?? [];
    const currentIds = new Set(payload?.current_custom_ids ?? []);
    if (!visitor) return { current: [] as Definition[], historical: definitions.filter((item) => values[item.id] !== undefined) };
    return {
      current: definitions.filter((item) => currentIds.has(item.id) && item.status === "active"),
      historical: definitions.filter((item) => !currentIds.has(item.id) && values[item.id] !== undefined),
    };
  }, [payload, values, visitor]);

  const saveValues = useMemo<PersonCustomFieldSaveValue[]>(() => {
    const definitions = [...current, ...historical].filter((field) => field.status === "active");
    return definitions.map((field) => ({ field_id: field.id, value: values[field.id] ?? null }));
  }, [current, historical, values]);

  useEffect(() => {
    onValuesChange?.(saveValues);
  }, [onValuesChange, saveValues]);

  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/people/${memberId}/custom-fields`, { method: "PATCH", headers: await headers(), body: JSON.stringify({ values: saveValues }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Unable to save custom fields.");
      setMessage("Custom fields saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save custom fields."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-slate-500">Loading custom fields…</div>;
  if (!payload && message) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</div>;
  const retiredStandard = payload?.retired_standard_fields ?? [];
  if (!current.length && !historical.length && !retiredStandard.length) return null;
  const renderFields = (items: Definition[]) => <div className="grid gap-3 sm:grid-cols-2">{items.map((field) => <label key={field.id} className="text-xs font-semibold text-slate-600">{field.name}<FieldControl definition={field} value={values[field.id] ?? (field.field_type === "multiple_choice" ? [] : "")} onChange={(value) => setValues((old) => ({ ...old, [field.id]: value }))} /></label>)}</div>;
  return <div className="space-y-4">
    {current.length ? <section><div className="mb-3 text-xs font-semibold text-slate-600">Form details</div>{renderFields(current)}</section> : null}
    {historical.length || retiredStandard.length ? <details className="rounded-2xl border"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Custom fields ({historical.length + retiredStandard.length})</summary><div className="space-y-4 border-t p-4">{retiredStandard.length ? <div className="grid gap-3 sm:grid-cols-2">{retiredStandard.map((field) => <div key={field.key} className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-semibold text-slate-600">{field.label}</div><div className="mt-1 whitespace-pre-wrap break-words text-sm">{Array.isArray(field.value) ? field.value.join(", ") : String(field.value)}</div><div className="mt-1 text-[11px] text-slate-400">No longer on the current First Timers Form</div></div>)}</div> : null}{historical.length ? renderFields(historical) : null}</div></details> : null}
    {showSaveButton ? <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">{message}</span><button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">{saving ? "Saving…" : "Save custom fields"}</button></div> : message ? <div className="text-xs text-rose-600">{message}</div> : null}
  </div>;
}
