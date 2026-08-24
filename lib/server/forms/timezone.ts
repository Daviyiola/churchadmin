import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function fetchOrganizationTimezone(organizationId: string) {
  const { data, error } = await supabaseAdmin.from("organization_settings")
    .select("timezone_name")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.timezone_name || "UTC");
}

function timezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function localDateStartIso(date: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day);
  let guess = new Date(desired);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = timezoneParts(guess, timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = new Date(guess.getTime() + desired - represented);
  }
  return guess.toISOString();
}

export function nextLocalDate(date: string) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function formatOrganizationTimestamp(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}
