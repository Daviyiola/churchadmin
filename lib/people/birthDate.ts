export type BirthDatePrecision = "full" | "month_day";

export function isValidMonthDay(month: number, day: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function parseMonthDay(value: string) {
  const match = /^(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return isValidMonthDay(month, day) ? { month, day } : null;
}

export function monthDayValue(month: number | null, day: number | null) {
  if (month === null || day === null || !isValidMonthDay(month, day)) return "";
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthDayFromIsoDate(value: string) {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return isValidMonthDay(month, day) ? { month, day } : null;
}

export function formatMonthDay(month: number | null, day: number | null) {
  if (month === null || day === null || !isValidMonthDay(month, day)) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, day)));
}

export function daysForMonth(month: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 31;
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
