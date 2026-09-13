"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { localDateTime, nextOccurrences, validateRecurrence, WEEKDAYS, type Recurrence, type SavedRecurrence } from "@/lib/attendance/recurrence";
import type { ServiceOption } from "@/components/ServiceCombobox";

export default function RecurrenceEditor({ name, schedule, defaultService, timezone, services, expiresOn, onSave, onClose }: {
  name: string; schedule?: SavedRecurrence | null; defaultService: string | null; timezone: string;
  services: ServiceOption[]; expiresOn: string | null; onSave: (value: Recurrence) => Promise<void>; onClose: () => void;
}) {
  const [rule, setRule] = useState<Recurrence>(() => ({ service_category_id: schedule?.service_category_id || defaultService || services[0]?.id || "", starts_on: schedule?.starts_on || localDateTime(new Date(), timezone).slice(0, 10), ends_on: schedule?.ends_on || null, every_weeks: schedule?.every_weeks || 1, weekdays: schedule?.weekdays || [0], service_time: schedule?.service_time.slice(0, 5) || "10:00", opens_before_minutes: schedule?.opens_before_minutes ?? 30, closes_after_minutes: schedule?.closes_after_minutes ?? 90 }));
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }); }, [error]);
  const preview = useMemo(() => { try { return nextOccurrences(validateRecurrence(rule), timezone, new Date(), [], expiresOn, 4); } catch { return []; } }, [rule, timezone, expiresOn]);
  function update<K extends keyof Recurrence>(key: K, value: Recurrence[K]) { setRule(current => ({ ...current, [key]: value })); }
  const field = "mt-1 w-full rounded-2xl border px-4 py-3 text-sm";
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(validateRecurrence(rule)); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to save. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
    <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="recurrence-heading" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl sm:p-6">
      <h2 id="recurrence-heading" className="text-lg font-bold">Repeat check-in for {name}</h2>
      <p className="mt-2 text-sm text-slate-600">Times use {timezone}. We’ll use a matching draft or create one 15 minutes before check-in opens. Attendance stays a draft until staff publishes it.</p>
      {error && <div ref={errorRef} role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <fieldset disabled={busy} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold">Service<select aria-label="Service" required value={rule.service_category_id} onChange={e => update("service_category_id", e.target.value)} className={field}><option value="">Choose a service</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label className="block text-sm font-semibold">Repeat every<select aria-label="Repeat every" value={rule.every_weeks} onChange={e => update("every_weeks", Number(e.target.value))} className={field}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1 === 1 ? "Week" : `${i + 1} weeks`}</option>)}</select></label>
        <fieldset><legend className="text-sm font-semibold">On these days</legend><div className="mt-2 flex flex-wrap gap-2">{WEEKDAYS.map((day, index) => <label key={day} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><input type="checkbox" checked={rule.weekdays.includes(index)} onChange={e => update("weekdays", e.target.checked ? [...rule.weekdays, index] : rule.weekdays.filter(value => value !== index))} />{day.slice(0, 3)}</label>)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Starting on<input required type="date" value={rule.starts_on} onChange={e => update("starts_on", e.target.value)} className={field} /></label><label className="text-sm font-semibold">Ending on (optional)<input type="date" min={rule.starts_on} value={rule.ends_on || ""} onChange={e => update("ends_on", e.target.value || null)} className={field} /></label></div>
        <label className="block text-sm font-semibold">Service starts at<input required type="time" value={rule.service_time} onChange={e => update("service_time", e.target.value)} className={field} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Open minutes before<input required type="number" min={0} max={180} value={rule.opens_before_minutes} onChange={e => update("opens_before_minutes", Number(e.target.value))} className={field} /></label><label className="text-sm font-semibold">Close minutes after start<input required type="number" min={1} max={720} value={rule.closes_after_minutes} onChange={e => update("closes_after_minutes", Number(e.target.value))} className={field} /></label></div>
      </fieldset>
      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm"><h3 className="font-semibold">Upcoming check-in windows</h3>{preview.length ? <ul className="mt-2 space-y-2">{preview.map(item => <li key={item.date}>{new Date(item.opens_at).toLocaleString(undefined, { timeZone: timezone })} – {new Date(item.closes_at).toLocaleTimeString(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" })}</li>)}</ul> : <p className="mt-2">No upcoming dates. Check the selected days, dates, and QR expiry.</p>}<p className="mt-3 text-xs text-slate-500">Weekly intervals start on Monday. Local service times stay the same through daylight saving changes. Nonexistent spring-forward times are skipped; repeated autumn times use the later occurrence.</p></div>
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-2xl border px-4 py-3">Cancel</button><button disabled={busy || !preview.length} className="rounded-2xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : "Save recurring schedule"}</button></div>
    </form>
  </div>;
}
