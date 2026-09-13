import { normalizeUsSmsPhone } from "./phone";

export type SmsCategory = "informational" | "promotional";
export type SmsPermissionEvent = {
  id: string; phone_e164: string; category: SmsCategory; status: "granted" | "revoked";
  method: "verbal" | "written" | "staff_opt_out"; disclosure: string; evidence_note: string;
  obtained_at: string; created_at: string; recorded_by: string | null;
};

export function permissionKey(phone: string, category: SmsCategory) { return `${phone}:${category}`; }

// Historical entries cannot override a more recent choice. On exact ties, opt-out wins.
export function currentSmsPermissions(events: SmsPermissionEvent[]) {
  const result = new Map<string, SmsPermissionEvent>();
  for (const event of events) {
    const key = permissionKey(event.phone_e164, event.category);
    const previous = result.get(key);
    const time = Date.parse(event.obtained_at);
    if (!Number.isFinite(time) || time > Date.now()) continue;
    if (!previous || time > Date.parse(previous.obtained_at) ||
      (time === Date.parse(previous.obtained_at) && (event.status === "revoked" ||
        (previous.status !== "revoked" && event.created_at > previous.created_at)))) result.set(key, event);
  }
  return result;
}

export function parsePermissionInput(body: Record<string, unknown>, now = new Date()) {
  const phone = normalizeUsSmsPhone(body.phone);
  if (!phone.ok) throw new Error("Enter a valid US phone number.");
  if (body.category !== "informational" && body.category !== "promotional") throw new Error("Choose a message category.");
  if (body.status !== "granted" && body.status !== "revoked") throw new Error("Choose permission or opt-out.");
  const category = body.category;
  const status = body.status;
  const method = status === "revoked" ? "staff_opt_out" : body.method;
  if (method !== "verbal" && method !== "written" && method !== "staff_opt_out") throw new Error("Choose how permission was received.");
  if (status === "granted" && method === "staff_opt_out") throw new Error("Choose verbal or written permission.");
  if (status === "granted" && category === "promotional" && method !== "written") throw new Error("Promotional messages need written permission.");
  if (body.confirmed !== true) throw new Error("Confirm the person's choice before recording it.");
  const disclosure = String(body.disclosure ?? "").trim();
  const evidence_note = String(body.evidence_note ?? "").trim();
  if (disclosure.length < 20 || disclosure.length > 5000) throw new Error("Record what the person agreed to (20–5,000 characters).");
  if (evidence_note.length > 2000 || (method === "written" && evidence_note.length < 10)) throw new Error("Describe where the written evidence is retained (10–2,000 characters).");
  const date = status === "revoked" ? now : new Date(String(body.obtained_at ?? ""));
  if (!Number.isFinite(date.getTime()) || date > now) throw new Error("Choose when permission was received, up to the current time.");
  return { phone_e164: phone.e164, category, status, method, disclosure, evidence_note, obtained_at: date.toISOString() };
}
