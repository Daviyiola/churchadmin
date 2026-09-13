import { isValidTimezone } from "@/lib/timezones";

export const ONBOARDING_DRAFT_KEY = "owner_onboarding_draft";
export const SELF_SERVICE_PLANS = ["free", "basic", "growth", "pro"] as const;
export const MAILING_FIELDS = ["mailing_address_line1", "mailing_address_line2", "mailing_city", "mailing_state", "mailing_postal_code", "mailing_country"] as const;
export type MailingField = typeof MAILING_FIELDS[number];
export function hasMailingAddress(value: Record<string, unknown> | null) {
  return !!value && MAILING_FIELDS.filter(key => key !== "mailing_address_line2")
    .every(key => typeof value[key] === "string" && (value[key] as string).trim().length > 0);
}
export function organizationName(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 120) {
    throw new Error("Enter an organization name between 2 and 120 characters.");
  }
  return value.trim();
}
export function setupSettings(body: Record<string, unknown>, orgId: string) {
  if (typeof body.timezone_name !== "string" || !isValidTimezone(body.timezone_name)) throw new Error("Choose a valid timezone.");
  const address = Object.fromEntries(MAILING_FIELDS.map(key => {
    const value = body[key];
    if (value != null && (typeof value !== "string" || value.length > 200)) throw new Error("Address fields must be 200 characters or fewer.");
    return [key, typeof value === "string" ? value.trim() || null : null];
  }));
  if (Object.values(address).some(Boolean) && !hasMailingAddress(address)) throw new Error("Complete the mailing address, or choose to add it later.");
  const logo = body.logo_path;
  if (logo != null && (typeof logo !== "string" || !logo.startsWith(`org/${orgId}/`) || logo.includes("..") || !/^org\/[a-zA-Z0-9-]+\/logo-[a-zA-Z0-9-]+\.(png|jpg|jpeg|svg)$/.test(logo))) throw new Error("Choose a logo uploaded for this organization.");
  return { ...address, mailing_country: address.mailing_country || "", timezone_name: body.timezone_name, timezone_confirmed: true, logo_path: logo || null, use_default_logo: !logo };
}
