import { parsePhoneNumberFromString } from "libphonenumber-js";

export type SmsPhoneFailure = "missing" | "extension" | "invalid" | "unsupported_country";

export type SmsPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: SmsPhoneFailure };

export function normalizeUsSmsPhone(value: unknown): SmsPhoneResult {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, reason: "missing" };
  if (/(?:ext\.?|extension|x)\s*\d+/i.test(raw)) return { ok: false, reason: "extension" };

  const parsed = parsePhoneNumberFromString(raw, "US");
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
  if (parsed.country !== "US" || parsed.countryCallingCode !== "1") {
    return { ok: false, reason: "unsupported_country" };
  }
  return { ok: true, e164: parsed.number };
}
