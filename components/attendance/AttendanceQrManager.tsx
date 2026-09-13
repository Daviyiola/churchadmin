"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QrCodeBox from "@/components/QrCodeBox";
import ServiceCombobox, { type ServiceOption } from "@/components/ServiceCombobox";
import { attendanceStaffApi } from "@/lib/attendance/staffApi";
import RecurrenceEditor from "./RecurrenceEditor";
import { localDateTime, zonedDateTime, type SavedRecurrence, type Recurrence } from "@/lib/attendance/recurrence";

type Draft = { id: string; service_category_id: string; session_date: string };
type WindowRow = {
  id: string;
  session_id: string;
  opens_at: string;
  closes_at: string;
  status: string;
  attendance_sessions?: {
    session_date: string;
    service_category_id: string;
    categories?: { name: string } | { name: string }[];
  } | null;
};
type Code = {
  schedule?: SavedRecurrence | null;
  id: string;
  name: string;
  default_service_category_id: string | null;
  expires_on: string | null;
  status: string;
  public_url: string;
  attendance_checkin_windows?: WindowRow[];
};
type CodeForm = {
  name: string;
  serviceId: string;
  expiryMode: "never" | "date";
  expiry: string;
};

async function api(orgId: string, path: string, method = "GET", body?: unknown) {
  return attendanceStaffApi(path, { method, headers: {
    "x-organization-id": orgId,
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const emptyForm: CodeForm = { name: "", serviceId: "", expiryMode: "never", expiry: "" };

export default function AttendanceQrManager({
  orgId,
  drafts,
  services,
  initialDraftId,
  onChanged,
}: {
  orgId: string;
  drafts: Draft[];
  services: ServiceOption[];
  initialDraftId: string | null;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<Code[]>([]);
  const [createdServices, setCreatedServices] = useState<ServiceOption[]>([]);
  const [timezone, setTimezone] = useState<{ timezone_name: string | null; timezone_confirmed: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Code | null>(null);
  const [form, setForm] = useState<CodeForm>(emptyForm);
  const [view, setView] = useState<Code | null>(null);
  const [attach, setAttach] = useState<Code | null>(null);
  const [sessionId, setSessionId] = useState(initialDraftId ?? "");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [recurring, setRecurring] = useState<Code | null>(null);
  const [recurrenceAvailable, setRecurrenceAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!open) return;
    try {
      const body = await api(orgId, "/api/attendance/check-in-codes");
      setCodes(body.codes);
      setTimezone(body.timezone);
      setRecurrenceAvailable(body.recurrence_available !== false);
      setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load QR codes."); }
  }, [open, orgId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => { if (!open) return; const timer = window.setInterval(() => { void load().then(() => onChanged?.()); }, 30000); return () => window.clearInterval(timer); }, [open, load, onChanged]);

  const timeZone = timezone?.timezone_name || "UTC";
  const activeCount = useMemo(() => codes.filter((code) => code.status !== "revoked").length, [codes]);
  const serviceOptions = useMemo(
    () => [...services, ...createdServices.filter((created) => !services.some((service) => service.id === created.id))],
    [createdServices, services],
  );

  function addService(option: ServiceOption) {
    setCreatedServices((current) => current.some((item) => item.id === option.id) ? current : [...current, option]);
    onChanged?.();
  }

  function showEdit(code: Code) {
    setForm({
      name: code.name,
      serviceId: code.default_service_category_id ?? "",
      expiryMode: code.expires_on ? "date" : "never",
      expiry: code.expires_on ?? "",
    });
    setEditing(code);
  }

  function showWindow(code: Code) {
    const now = new Date();
    setAttach(code);
    setSessionId(drafts.find(draft => draft.id === initialDraftId && (!code.default_service_category_id || draft.service_category_id === code.default_service_category_id))?.id || drafts.find(draft => draft.service_category_id === code.default_service_category_id && draft.session_date === localDateTime(now, timeZone).slice(0, 10))?.id || "");
    setStarts(localDateTime(now, timeZone));
    setEnds(localDateTime(new Date(now.getTime() + 4 * 60 * 60 * 1000), timeZone));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to complete the request. Try again."); }
    finally { setBusy(false); }
  }

  async function saveCode(code?: Code) {
    await run(async () => {
      await api(orgId, code ? `/api/attendance/check-in-codes/${code.id}` : "/api/attendance/check-in-codes", code ? "PATCH" : "POST", {
        name: form.name.trim(), default_service_category_id: form.serviceId || null, expires_on: form.expiryMode === "date" ? form.expiry : null,
      });
      setCreateOpen(false); setEditing(null); setForm(emptyForm); await load(); onChanged?.();
    });
  }

  async function openWindow() {
    if (!attach) return;
    await run(async () => {
      const opens = zonedDateTime(starts, timeZone), closes = zonedDateTime(ends, timeZone);
      if (closes <= opens) throw new Error("Closing time must be after opening time.");
      await api(orgId, `/api/attendance/check-in-codes/${attach.id}/windows`, "POST", { session_id: sessionId, opens_at: opens, closes_at: closes });
      setAttach(null); await load(); onChanged?.();
    });
  }

  async function closeWindow(windowId: string) {
    await run(async () => { await api(orgId, `/api/attendance/check-in-windows/${windowId}`, "PATCH", { action: "close" }); await load(); onChanged?.(); });
  }

  async function revoke(code: Code) {
    if (!window.confirm(`Revoke "${code.name}"? Its current URL will stop working.`)) return;
    await run(async () => { await api(orgId, `/api/attendance/check-in-codes/${code.id}`, "DELETE"); await load(); });
  }

  async function scheduleAction(code: Code, action: "pause" | "resume" | "skip", date?: string) {
    await run(async () => { await api(orgId, `/api/attendance/check-in-codes/${code.id}/schedule`, "PATCH", { action, date }); await load(); onChanged?.(); });
  }

  async function saveSchedule(rule: Recurrence) {
    if (!recurring) return;
    await api(orgId, `/api/attendance/check-in-codes/${recurring.id}/schedule`, "PUT", rule);
    await load(); onChanged?.();
  }

  const codeFormModal = createOpen || editing;

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">QR Check-in</button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
              <div><h2 className="text-lg font-bold">Attendance QR codes</h2><p className="text-sm text-slate-600">{activeCount} of 5 reusable codes</p></div>
              <button onClick={() => setOpen(false)} className="rounded-2xl border px-4 py-2">Close</button>
            </div>
            <div className="space-y-5 p-6">
              {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
              <button disabled={busy} onClick={() => void run(async () => { if (recurrenceAvailable) await api(orgId, "/api/attendance/recurrence/refresh", "POST", {}); await load(); onChanged?.(); })} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40">{recurrenceAvailable ? "Refresh schedules" : "Refresh QR codes"}</button>
              {!recurrenceAvailable && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Automatic repeating check-in is not available yet. You can still use your QR codes with one-time check-in windows.</p>}
              {!timezone?.timezone_confirmed ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Confirm the organization timezone before setting up QR check-in. <a className="font-semibold underline" href="/app/settings/org#timezone">Open Organization settings</a></div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-slate-600">Repeat check-in automatically, or attach a one-time window to an existing draft.</p>
                <button
                  disabled={activeCount >= 5 || !timezone?.timezone_confirmed}
                  onClick={() => { setForm(emptyForm); setCreateOpen(true); }}
                  className="shrink-0 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >New QR code</button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {codes.map((code) => {
                  const currentWindow = code.attendance_checkin_windows?.find((row) => ["scheduled", "open"].includes(row.status) && Date.parse(row.closes_at) > Date.now());
                  const category = currentWindow?.attendance_sessions?.categories;
                  const serviceName = category ? (Array.isArray(category) ? category[0]?.name : category.name) : null;
                  return (
                    <article key={code.id} className={`rounded-3xl border p-5 ${code.status === "revoked" ? "bg-slate-50 opacity-70" : "bg-white"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div><h3 className="font-bold">{code.name}</h3><p className="text-xs text-slate-600">{code.expires_on ? `Expires ${code.expires_on}` : "Never expires"}</p></div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentWindow ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{code.status === "revoked" ? "Revoked" : currentWindow ? (Date.parse(currentWindow.opens_at) <= Date.now() ? "Open now" : "Scheduled") : code.schedule?.paused ? "Paused" : code.schedule?.last_error ? "Needs attention" : code.schedule ? "Repeating" : "Available"}</span>
                      </div>
                      {currentWindow ? (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">
                          <strong>{serviceName || "Service"}</strong> · {currentWindow.attendance_sessions?.session_date}<br />
                          <span className="text-xs text-slate-600">{new Date(currentWindow.opens_at).toLocaleString(undefined, { timeZone })} – {new Date(currentWindow.closes_at).toLocaleString(undefined, { timeZone })}</span>
                        </div>
                      ) : null}
                      {code.schedule && <div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3 text-sm">
                        <p className="font-semibold">Every {code.schedule.every_weeks === 1 ? "week" : `${code.schedule.every_weeks} weeks`} · {code.schedule.service_time.slice(0, 5)} ({code.schedule.timezone_name})</p>
                        {code.schedule.last_error && <p role="alert" className="text-amber-800">{code.schedule.last_error}</p>}
                        {!code.schedule.paused && <ul className="space-y-2">{code.schedule.upcoming.slice(0, 3).map(item => <li key={item.date} className="flex flex-wrap items-center justify-between gap-2"><span>{new Date(item.opens_at).toLocaleString(undefined, { timeZone: code.schedule!.timezone_name })}{item.skipped ? " · Skipped" : ""}</span>{!item.skipped && code.status !== "revoked" && <button disabled={busy} onClick={() => void scheduleAction(code, "skip", item.date)} className="text-xs underline">Skip {item.date}</button>}</li>)}</ul>}
                        <p className="text-xs text-slate-500">A matching draft is reused, or one is created automatically. Closed occurrences stay closed.</p>
                      </div>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => setView(code)} className="rounded-xl border px-3 py-2 text-xs font-semibold">View / download</button>
                        {code.status !== "revoked" ? <>
                          <button onClick={() => showEdit(code)} className="rounded-xl border px-3 py-2 text-xs font-semibold">Edit</button>
                          <button disabled={busy || !timezone?.timezone_confirmed || !recurrenceAvailable} onClick={() => { setError(""); setRecurring(code); }} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40">{code.schedule ? "Edit recurrence" : "Repeat automatically"}</button>
                          {code.schedule && <button disabled={busy} onClick={() => void scheduleAction(code, code.schedule!.paused ? "resume" : "pause")} className="rounded-xl border px-3 py-2 text-xs font-semibold">{code.schedule.paused ? "Resume recurrence" : "Pause recurrence"}</button>}
                          <button disabled={busy || !drafts.length} onClick={() => showWindow(code)} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{currentWindow ? "Reassign window" : "One-time window"}</button>
                          {currentWindow ? <button onClick={() => void closeWindow(currentWindow.id)} className="rounded-xl border px-3 py-2 text-xs">Close window</button> : null}
                          <button onClick={() => void revoke(code)} className="rounded-xl border border-red-200 px-3 py-2 text-xs text-red-700">Revoke</button>
                        </> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!codes.length ? <div className="rounded-3xl border border-dashed p-8 text-center text-sm text-slate-600">No QR codes yet.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {codeFormModal ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/35 p-4">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">{editing ? "Edit attendance QR code" : "New attendance QR code"}</h2>
            {error && <div role="alert" className="mt-3 text-sm text-red-700">{error}</div>}
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-semibold">QR name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Lobby check-in" className="mt-1 w-full rounded-2xl border px-4 py-3" /></label>
              <div>
                <div className="mb-1 text-sm font-semibold">Default service</div>
                <ServiceCombobox orgId={orgId} value={form.serviceId} services={serviceOptions} onChange={(serviceId) => setForm((current) => ({ ...current, serviceId }))} onCreated={addService} />
                {form.serviceId ? <button type="button" onClick={() => setForm((current) => ({ ...current, serviceId: "" }))} className="mt-1 text-xs text-slate-600 underline">Clear default service</button> : null}
              </div>
              <label className="block text-sm font-semibold">Expires<select value={form.expiryMode} onChange={(event) => setForm((current) => ({ ...current, expiryMode: event.target.value as "never" | "date" }))} className="mt-1 w-full rounded-2xl border px-4 py-3"><option value="never">Never</option><option value="date">Choose date</option></select></label>
              {form.expiryMode === "date" ? <input type="date" min={localDateTime(new Date(), timeZone).slice(0, 10)} value={form.expiry} onChange={(event) => setForm((current) => ({ ...current, expiry: event.target.value }))} className="w-full rounded-2xl border px-4 py-3" /> : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => { setCreateOpen(false); setEditing(null); }} className="rounded-2xl border px-4 py-2">Cancel</button>
              <button disabled={busy || !form.name.trim() || (form.expiryMode === "date" && !form.expiry)} onClick={() => void saveCode(editing ?? undefined)} className="rounded-2xl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-40">{editing ? "Save changes" : "Create"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {attach ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/35 p-4">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Open or schedule {attach.name}</h2>
            {error && <div role="alert" className="mt-3 text-sm text-red-700">{error}</div>}
            <p className="mt-1 text-sm text-slate-600">Times use {timeZone}.</p>
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-semibold">Attendance draft<select value={sessionId} onChange={(event) => setSessionId(event.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3"><option value="">Choose a draft</option>{drafts.map((draft) => <option key={draft.id} value={draft.id}>{serviceOptions.find((service) => service.id === draft.service_category_id)?.name || "Service"} · {draft.session_date}</option>)}</select></label>
              <label className="block text-sm font-semibold">Opens<input type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3" /></label>
              <label className="block text-sm font-semibold">Closes<input type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3" /></label>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button onClick={() => setAttach(null)} className="rounded-2xl border px-4 py-2">Cancel</button><button disabled={busy || !sessionId || !starts || !ends} onClick={() => void openWindow()} className="rounded-2xl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-40">Save window</button></div>
          </div>
        </div>
      ) : null}

      {recurring && <RecurrenceEditor name={recurring.name} schedule={recurring.schedule} defaultService={recurring.default_service_category_id} timezone={timeZone} services={serviceOptions} expiresOn={recurring.expires_on} onSave={saveSchedule} onClose={() => setRecurring(null)} />}

      {view ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/35 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl"><QrCodeBox url={view.public_url} title={`Scan for ${view.name}`} /><button onClick={() => setView(null)} className="mt-4 w-full rounded-2xl border px-4 py-2">Close</button></div>
        </div>
      ) : null}
    </>
  );
}
