import { isYYYYMMDD } from "@/lib/schedule/util";
import { isValidTimezone } from "@/lib/timezones";

export type Recurrence = {
  service_category_id: string;
  starts_on: string;
  ends_on: string | null;
  every_weeks: number;
  weekdays: number[];
  service_time: string;
  opens_before_minutes: number;
  closes_after_minutes: number;
};
export type Occurrence = { date: string; service_at: string; opens_at: string; closes_at: string; skipped: boolean };
export type SavedRecurrence = Recurrence & { code_id: string; timezone_name: string; paused: boolean; last_error: string | null; upcoming: Occurrence[] };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function validateRecurrence(body: Record<string, unknown>): Recurrence {
  const allowed = new Set(["service_category_id", "starts_on", "ends_on", "every_weeks", "weekdays", "service_time", "opens_before_minutes", "closes_after_minutes"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error("Unsupported schedule field.");
  if (typeof body.service_category_id !== "string" || !/^[a-f\d-]{36}$/i.test(body.service_category_id)) throw new Error("Choose a service.");
  if (typeof body.starts_on !== "string" || !isYYYYMMDD(body.starts_on)) throw new Error("Choose a valid start date.");
  const end = body.ends_on || null;
  if (end !== null && (typeof end !== "string" || !isYYYYMMDD(end) || end < body.starts_on)) throw new Error("End date must be on or after the start date.");
  if (!Number.isInteger(body.every_weeks) || Number(body.every_weeks) < 1 || Number(body.every_weeks) > 12) throw new Error("Repeat every 1 to 12 weeks.");
  if (!Array.isArray(body.weekdays) || body.weekdays.length < 1 || body.weekdays.length > 7 || body.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choose at least one weekday.");
  if (typeof body.service_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(body.service_time)) throw new Error("Choose a valid service time.");
  if (!Number.isInteger(body.opens_before_minutes) || Number(body.opens_before_minutes) < 0 || Number(body.opens_before_minutes) > 180) throw new Error("Open check-in 0 to 180 minutes before the service.");
  if (!Number.isInteger(body.closes_after_minutes) || Number(body.closes_after_minutes) < 1 || Number(body.closes_after_minutes) > 720) throw new Error("Close check-in 1 to 720 minutes after the service starts.");
  return { service_category_id: body.service_category_id, starts_on: body.starts_on, ends_on: end as string | null, every_weeks: Number(body.every_weeks), weekdays: [...new Set(body.weekdays)].sort(), service_time: body.service_time.slice(0, 5), opens_before_minutes: Number(body.opens_before_minutes), closes_after_minutes: Number(body.closes_after_minutes) };
}

export function localDateTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Match PostgreSQL's standard-time choice for repeated autumn times. Reject gaps. */
export function zonedDateTime(value: string, timeZone: string) {
  if (!isValidTimezone(timeZone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !isYYYYMMDD(value.slice(0, 10))) throw new Error("Choose a valid date and time.");
  const naive = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(naive)) throw new Error("Choose a valid date and time.");
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = naive + hours * 3600000;
    offsets.add(Date.parse(`${localDateTime(new Date(probe), timeZone)}:00Z`) - probe);
  }
  const matches = [...offsets].map(offset => naive - offset).filter(time => localDateTime(new Date(time), timeZone) === value);
  if (!matches.length) throw new Error("This local time does not exist because of daylight saving time. Choose another time.");
  return new Date(Math.max(...matches)).toISOString();
}

export function matchesDate(rule: Recurrence, date: string) {
  if (date < rule.starts_on || (rule.ends_on && date > rule.ends_on)) return false;
  const start = new Date(`${rule.starts_on}T00:00:00Z`), target = new Date(`${date}T00:00:00Z`);
  const monday = start.getTime() - ((start.getUTCDay() + 6) % 7) * 86400000;
  return rule.weekdays.includes(target.getUTCDay()) && Math.floor((target.getTime() - monday) / 604800000) % rule.every_weeks === 0;
}

export function nextOccurrences(rule: Recurrence, timezone: string, now = new Date(), skipped: string[] = [], expiresOn: string | null = null, count = 5): Occurrence[] {
  if (!isValidTimezone(timezone)) return [];
  const today = localDateTime(now, timezone).slice(0, 10);
  const start = Math.max(Date.parse(`${today}T00:00:00Z`) - 86400000, Date.parse(`${rule.starts_on}T00:00:00Z`));
  const result: Occurrence[] = [];
  for (let day = 0; day < 730 && result.length < count; day++) {
    const date = new Date(start + day * 86400000).toISOString().slice(0, 10);
    if ((rule.ends_on && date > rule.ends_on) || (expiresOn && date > expiresOn)) break;
    if (!matchesDate(rule, date)) continue;
    let service: string;
    try { service = zonedDateTime(`${date}T${rule.service_time.slice(0, 5)}`, timezone); } catch { continue; }
    const closes = new Date(Date.parse(service) + rule.closes_after_minutes * 60000).toISOString();
    if (Date.parse(closes) <= now.getTime()) continue;
    if (expiresOn && localDateTime(new Date(Date.parse(closes) - 1), timezone).slice(0, 10) > expiresOn) continue;
    result.push({ date, service_at: service, opens_at: new Date(Date.parse(service) - rule.opens_before_minutes * 60000).toISOString(), closes_at: closes, skipped: skipped.includes(date) });
  }
  return result;
}
